import {ValueSource} from '../property/property-store.js';
import {prepareSetters, transactionStores, materializeSetterResource} from '../styles/setter-plan.js';
import {ResourceFault} from '../resources/errors.js';
import {DisposableScope} from '../object-model/disposable-scope.js';
import {activeState, AdaptiveTrigger} from './state-trigger.js';
import {stateList, validateStateGroups} from './state-limits.js';

/** Per-control visual states share the property store, preserving local values and restoring lower layers. */
export class VisualStateManager {
  constructor({target, store, registry, groups = [], resources = null, namescope = null,
    storeFor = () => null, animations = null, bind = null, materializeResource = null} = {}) {
    this.context = {target, store, registry, resources, namescope, storeFor, bind, materializeResource};
    this.groups = stateList(groups, 256, 'Visual state group');
    this.animations = animations;
    this.states = new Map();
    this.layers = new Map();
    this.animationHandles = new Map();
    this.lifetime = new DisposableScope();
    this.stateLifetime = new DisposableScope();
    this.pendingTransition = new Map();
    this.transitionVersions = new Map();
    this.changeQueue = [];
    this.processingChanges = false;
    this.updating = false;
    this.disposed = false;
    try { this.index(); }
    catch (error) { this.lifetime.dispose(); throw error; }
  }

  index() {
    validateStateGroups(this.groups);
    const changed = () => this.setGroups(this.groups, {force: true});
    const triggered = () => this.evaluateTriggers();
    const target = this.context.target;
    changed.retainedValues = triggered.retainedValues = function* () { yield target; };
    for (const group of this.groups) {
      this.lifetime.add(group.subscribeDefinition(changed));
      for (const state of group.states) {
        this.states.set(state.name, {group, state});
        this.lifetime.add(state.subscribeDefinition(changed));
        for (const trigger of state.triggers) this.lifetime.add(trigger.subscribe(triggered));
      }
    }
  }

  setGroups(groups, {namescope = this.context.namescope, force = false} = {}) {
    if (this.disposed) throw new ResourceFault('SFSTATE002', 'VisualStateManager is disposed.');
    if (this.processingChanges) throw new ResourceFault('SFSTATE006', 'Cannot replace visual state definitions during a transition callback.');
    groups = stateList(groups, 256, 'Visual state group');
    if (!force && namescope === this.context.namescope && groups.length === this.groups.length &&
      groups.every((group, index) => group === this.groups[index])) return;
    const previous = {groups: this.groups, states: this.states, lifetime: this.lifetime,
      layers: this.layers, namescope: this.context.namescope};
    this.groups = groups; this.states = new Map(); this.lifetime = new DisposableScope(); this.layers = new Map();
    this.context.namescope = namescope;
    try {
      this.index();
      for (const group of this.groups) {
        if (group.currentState && group.states.includes(group.currentState)) {
          this.layers.set(group, prepareSetters(group.currentState.setters, this.context));
        }
      }
      this.applyLayers();
    } catch (error) {
      this.lifetime.dispose();
      Object.assign(this, {groups: previous.groups, states: previous.states, lifetime: previous.lifetime, layers: previous.layers});
      this.context.namescope = previous.namescope;
      throw error;
    }
    previous.lifetime.dispose();
    for (const group of previous.groups) if (!this.groups.includes(group)) this.cancelAnimations(group);
    this.evaluateTriggers();
  }

  goToState(name, useTransitions = true) {
    if (this.disposed) throw new ResourceFault('SFSTATE002', 'VisualStateManager is disposed.');
    const found = this.states.get(name);
    if (!found) return false;
    this.change(found.group, found.state, useTransitions);
    return true;
  }

  change(group, state, useTransitions) {
    if (this.changeQueue.length >= 4096) throw new ResourceFault('SFSTATE006', 'Visual state change queue budget exceeded.');
    this.changeQueue.push({group, state, useTransitions});
    if (this.processingChanges) return;
    this.processingChanges = true;
    try {
      for (let index = 0; index < this.changeQueue.length; index++) {
        if (index >= 4096) throw new ResourceFault('SFSTATE006', 'Visual state change queue budget exceeded.');
        const request = this.changeQueue[index];
        this.performChange(request.group, request.state, request.useTransitions);
      }
    } finally {
      this.changeQueue.length = 0;
      this.processingChanges = false;
    }
  }

  performChange(group, state, useTransitions) {
    const previous = group.currentState;
    if (previous === state) return;
    const nextEntries = state ? prepareSetters(state.setters, this.context) : [];
    for (const entry of nextEntries) entry.from = entry.store.getValue(entry.property);
    const transition = useTransitions ? group.transition(previous, state) : null;
    if ((state?.storyboard || transition?.storyboard || transition?.generatedDuration) && !this.animations) {
      throw new ResourceFault('SFSTATE003', 'Visual state animations require the host AnimationClock adapter.');
    }
    const event = {control: this.context.target, oldState: previous, newState: state};
    for (const listener of [...group.changing]) listener(event);
    const previousLayer = this.layers.get(group);
    this.layers.set(group, nextEntries);
    try {
      this.applyLayers();
    } catch (error) {
      if (previousLayer) this.layers.set(group, previousLayer);
      else this.layers.delete(group);
      throw error;
    }
    this.cancelAnimations(group);
    const version = this.transitionVersions.get(group);
    group.currentState = state;
    const complete = () => {
      if (group.currentState !== state || this.transitionVersions.get(group) !== version || this.disposed) return;
      this.pendingTransition.delete(group);
      if (state?.storyboard) this.animationHandles.set(group, this.animations.begin(state.storyboard, this.context));
      for (const listener of [...group.changed]) listener(event);
    };
    if (transition && (transition.storyboard || transition.generatedDuration)) {
      this.pendingTransition.set(group, state);
      const handle = this.animations.transition(transition, previousLayer ?? [], nextEntries, this.context, complete);
      if (this.pendingTransition.get(group) === state && this.transitionVersions.get(group) === version) {
        this.animationHandles.set(group, handle);
      }
    } else complete();
  }

  applyLayers() {
    const combined = new Map();
    for (const group of this.groups) {
      for (const entry of this.layers.get(group) ?? []) {
        let properties = combined.get(entry.store);
        if (!properties) combined.set(entry.store, properties = new Map());
        properties.set(entry.property, entry);
      }
    }
    const entries = [...combined.values()].flatMap(properties => [...properties.values()]);
    const previous = this.applied ?? [];
    const lifetime = new DisposableScope();
    const previousLifetime = this.stateLifetime.snapshot();
    try {
      transactionStores([...previous, ...entries].map(entry => entry.store), () => {
        this.stateLifetime.dispose();
        for (const entry of previous) entry.store.clearSource(entry.property, ValueSource.VisualState);
        for (const entry of entries) this.attach(entry, lifetime);
      });
    } catch (error) {
      lifetime.dispose({preserveValues: true, clear: false});
      this.stateLifetime.restore(previousLifetime);
      throw error;
    }
    this.stateLifetime = lifetime;
    this.applied = entries;
  }

  attach(entry, lifetime) {
    if (entry.binding) {
      lifetime.add(this.context.bind({...entry, binding: entry.value, source: ValueSource.VisualState}));
    } else if (entry.reference?.dynamic) {
      lifetime.add(this.context.resources.observe(entry.reference, {
        validate: value => entry.store.validateValue(entry.property,
          materializeSetterResource(this.context, entry.property, value), {coerce: false}),
        changed: value => entry.store.setSource(entry.property, ValueSource.VisualState,
          materializeSetterResource(this.context, entry.property, value))
      }));
    } else entry.store.setSource(entry.property, ValueSource.VisualState, entry.value);
  }

  cancelAnimations(group) {
    this.transitionVersions.set(group, (this.transitionVersions.get(group) ?? 0) + 1);
    const handle = this.animationHandles.get(group);
    handle?.cancel?.();
    handle?.dispose?.();
    this.animationHandles.delete(group);
    this.pendingTransition.delete(group);
  }

  evaluateTriggers() {
    if (this.updating || this.disposed) return;
    this.updating = true;
    try {
      for (const group of this.groups) {
        const states = group.states.filter(state => state.triggers.length);
        if (states.length) this.change(group, activeState(states), true);
      }
    } finally { this.updating = false; }
  }

  updateSize(width, height) {
    if (![width, height].every(value => Number.isFinite(value) && value >= 0)) throw new RangeError('Invalid host size.');
    this.updating = true;
    try {
      for (const {state} of this.states.values()) {
        for (const trigger of state.triggers) if (trigger instanceof AdaptiveTrigger) trigger.update(width, height);
      }
    } finally { this.updating = false; }
    this.evaluateTriggers();
  }

  updateInput({enabled = true, pointerOver = false, pressed = false, focused = false, checked = false} = {}) {
    const common = !enabled ? 'Disabled' : pressed ? 'Pressed' : pointerOver ? 'PointerOver' : 'Normal';
    this.goToState(common, true);
    this.goToState(focused ? 'Focused' : 'Unfocused', true);
    this.goToState(checked === null ? 'Indeterminate' : checked ? 'Checked' : 'Unchecked', true);
  }

  snapshot() {
    if (this.processingChanges) throw new ResourceFault('SFSTATE006', 'Cannot snapshot an in-progress visual state callback.');
    return {context: {...this.context}, groups: this.groups.map(group => ({group, state: group.snapshot()})), states: [...this.states],
      layers: [...this.layers].map(([group, entries]) => [group, entries.map(entry => ({...entry}))]),
      applied: this.applied?.map(entry => ({...entry})), animationHandles: [...this.animationHandles],
      pendingTransition: [...this.pendingTransition], transitionVersions: [...this.transitionVersions],
      lifetime: this.lifetime.snapshot(), stateLifetime: this.stateLifetime.snapshot(),
      disposed: this.disposed};
  }

  /** AnimationClock and stores are restored by their owners; this restores only control-local state and subscriptions. */
  restore(snapshot) {
    this.lifetime.dispose({preserveValues: true, clear: false});
    this.stateLifetime.dispose({preserveValues: true, clear: false});
    this.context = snapshot.context;
    this.groups = snapshot.groups.map(saved => { saved.group.restore(saved.state); return saved.group; });
    this.states = new Map(snapshot.states);
    this.layers = new Map(snapshot.layers.map(([group, entries]) => [group, entries.map(entry => ({...entry}))]));
    this.applied = snapshot.applied?.map(entry => ({...entry}));
    this.animationHandles = new Map(snapshot.animationHandles);
    this.pendingTransition = new Map(snapshot.pendingTransition);
    this.transitionVersions = new Map(snapshot.transitionVersions ?? []);
    this.lifetime.restore(snapshot.lifetime);
    this.stateLifetime.restore(snapshot.stateLifetime);
    this.disposed = snapshot.disposed;
    this.updating = false;
    this.processingChanges = false;
    this.changeQueue.length = 0;
  }

  *retainedValues() {
    yield this.context?.target;
    for (const group of this.groups) yield* group.retainedValues();
    for (const entry of this.applied ?? []) { yield entry.target; yield entry.value; }
    yield* this.stateLifetime.retainedValues();
  }

  dispose({preserveValues = false} = {}) {
    if (this.disposed) return;
    this.lifetime.dispose({preserveValues});
    for (const group of this.groups) {
      if (!preserveValues) {
        this.cancelAnimations(group);
        group.currentState = null;
      }
    }
    this.layers.clear();
    if (!preserveValues) this.applyLayers();
    this.stateLifetime.dispose({preserveValues});
    this.animationHandles.clear();
    this.pendingTransition.clear();
    this.states.clear();
    this.groups.length = 0;
    this.context = null;
    this.disposed = true;
  }
}
