import {VisualState, VisualStateGroup, VisualTransition} from '../visual-states/visual-state.js';
import {StateTrigger, StateTriggerBase, AdaptiveTrigger} from '../visual-states/state-trigger.js';
import {VisualStateManager} from '../visual-states/visual-state-manager.js';
import {ResourceModelCollection, resourceScopeModel, setterModel} from './resource-adapter-models.js';
import {registerResourceCollectionAdapters} from './resource-collection-adapters.js';
import {registerModelEvent} from './model-events.js';

const x = 'Microsoft.UI.Xaml.';

export function visualStateGroups(context, owner) {
  return context.state(owner, 'visualStateGroups', () => ({values: [], control: null,
    snapshot() { return {control: this.control, values: this.values.map(group => ({group, state: group.snapshot()}))}; },
    restore(snapshot) {
      this.control = snapshot.control;
      this.values = snapshot.values.map(saved => { saved.group.restore(saved.state); return saved.group; });
    },
    *retainedValues() { yield this.control; for (const group of this.values) yield* group.retainedValues(); }}));
}

export function visualStateGroupCollection(context, owner) {
  const groups = visualStateGroups(context, owner);
  const collection = context.state(owner, 'visualStateGroupsView', () => new ResourceModelCollection({owner,
    read: () => groups.values, write: values => {
      const target = groups.control ?? owner;
      const manager = context.state(target, 'visualStateManager');
      manager?.setGroups(values);
      groups.values = values;
    }, unwrap: value => context.unwrapModel(value)}));
  return context.wrapModel(collection, x + 'VisualStateGroupCollection');
}

export function visualStateManagerModel(context, owner) {
  const host = context.state(owner, 'templateHost');
  const source = host?.instance?.root ?? owner;
  const groups = visualStateGroups(context, source);
  groups.control = owner;
  const namescope = host?.namescope ?? context.unwrapModel(context.read(source, '$nameScope')) ?? null;
  const manager = context.state(owner, 'visualStateManager', () => new VisualStateManager({target: owner,
    store: context.storeFor(owner), registry: context.propertyRegistry,
    groups: groups.values, resources: resourceScopeModel(context, owner), namescope,
    storeFor: value => context.storeFor(value), animations: context.visualStateAnimations, bind: context.bindSetter,
    materializeResource: context.materializeResource}));
  manager.setGroups(groups.values, {namescope});
  return manager;
}

export function stateTriggerModel(context, receiver) {
  const model = context.unwrapModel(receiver);
  if (model instanceof StateTriggerBase) return model;
  return context.state(receiver, 'stateTrigger', () => new StateTriggerBase({owner: receiver}));
}

/** Visual-state model wrappers expose state changes to the exact same store used by code-first controls. */
export function registerVisualStateResourceAdapters(registry) {
  const constructors = {
    VisualState: () => new VisualState('$unnamed'),
    VisualStateGroup: () => new VisualStateGroup(''),
    VisualTransition: () => new VisualTransition(),
    StateTrigger: () => new StateTrigger(),
    AdaptiveTrigger: () => new AdaptiveTrigger(),
    StateTriggerBase: () => new StateTriggerBase()
  };
  for (const [name, create] of Object.entries(constructors)) {
    registry.register({owner: x + name, kind: 'constructor', name: '.ctor'}, ({context}) => context.wrapModel(create(), x + name));
  }
  for (const [owner, property, field] of [
    ['VisualState', 'Name', 'name'], ['VisualStateGroup', 'Name', 'name'],
    ['VisualState', 'Storyboard', 'storyboard'], ['VisualTransition', 'From', 'from'],
    ['VisualTransition', 'To', 'to'], ['VisualTransition', 'Storyboard', 'storyboard'],
    ['VisualTransition', 'GeneratedDuration', 'generatedDuration'],
    ['VisualTransition', 'GeneratedEasingFunction', 'generatedEasingFunction'],
    ['AdaptiveTrigger', 'MinWindowWidth', 'minWindowWidth'], ['AdaptiveTrigger', 'MinWindowHeight', 'minWindowHeight']
  ]) registerStateProperty(registry, owner, property, field);
  registry.register({owner: x + 'StateTrigger', kind: 'get', name: 'get_IsActive'}, ({context, receiver}) =>
    stateTriggerModel(context, receiver).isActive);
  for (const [owner, kind, name] of [[x + 'StateTrigger', 'set', 'set_IsActive'], [x + 'StateTriggerBase', 'method', 'SetActive']]) {
    registry.register({owner, kind, name}, ({context, receiver, args}) => {
      stateTriggerModel(context, receiver).setActive(Boolean(context.native(args[0])));
      return null;
    });
  }
  for (const [owner, property, field, collection, element] of [
    ['VisualState', 'Setters', 'setters', 'SetterBaseCollection', 'Setter'],
    ['VisualState', 'StateTriggers', 'triggers', 'StateTriggerCollection', 'StateTriggerBase'],
    ['VisualStateGroup', 'States', 'states', 'VisualStateCollection', 'VisualState'],
    ['VisualStateGroup', 'Transitions', 'transitions', 'VisualTransitionCollection', 'VisualTransition']
  ]) registerStateCollection(registry, {owner, property, field, collection, element});
  for (const [collection, element] of [['VisualStateCollection', 'VisualState'], ['VisualTransitionCollection', 'VisualTransition'],
    ['StateTriggerCollection', 'StateTriggerBase'], ['VisualStateGroupCollection', 'VisualStateGroup']]) {
    registerResourceCollectionAdapters(registry, x + collection, x + element);
  }
  registry.register({owner: x + 'VisualStateGroup', kind: 'get', name: 'get_CurrentState'}, ({context, receiver}) =>
    context.wrapModel(context.unwrapModel(receiver).currentState, x + 'VisualState'));
  registerVisualStateEvents(registry);
  registry.register({owner: x + 'VisualStateManager', name: 'GetVisualStateGroups'}, ({context, args}) => {
    return visualStateGroupCollection(context, args[0]);
  });
  registry.register({owner: x + 'VisualStateManager', name: 'GoToState'}, ({context, args}) =>
    visualStateManagerModel(context, args[0]).goToState(context.native(args[1]), Boolean(context.native(args[2]))));
}

function registerVisualStateEvents(registry) {
  for (const name of ['CurrentStateChanging', 'CurrentStateChanged']) registerModelEvent(registry, {
    owner: x + 'VisualStateGroup', name,
    source: (context, receiver, listener) => context.unwrapModel(receiver)['on' + name](listener),
    invoke: (context, receiver, handler, event) => {
      const args = context.allocate(x + 'VisualStateChangedEventArgs', {
        OldState: event.oldState ? context.wrapModel(event.oldState, x + 'VisualState') : null,
        NewState: event.newState ? context.wrapModel(event.newState, x + 'VisualState') : null,
        Control: event.control
      });
      return context.invokeManaged(handler, [receiver, args]);
    }
  });
}

function registerStateProperty(registry, owner, property, field) {
  registry.register({owner: x + owner, kind: 'get', name: 'get_' + property}, ({context, receiver, descriptor}) =>
    context.managed(context.unwrapModel(receiver)[field], descriptor.result));
  registry.register({owner: x + owner, kind: 'set', name: 'set_' + property}, ({context, receiver, args}) => {
    const model = context.unwrapModel(receiver);
    let value = context.native(args[0]);
    if (field === 'storyboard') value = args[0];
    if (field === 'generatedDuration') value = context.durationMilliseconds?.(args[0]) ?? value?.timeSpan?.totalMilliseconds ?? 0;
    if (field === 'generatedEasingFunction') value = context.easingDefinition?.(args[0]) ?? context.unwrapModel(args[0]);
    if (field.startsWith('minWindow') && (!Number.isFinite(value) || value < 0)) throw new RangeError('Adaptive trigger size must be non-negative.');
    model[field] = value;
    if (field.startsWith('minWindow')) model.update(model.windowWidth ?? 0, model.windowHeight ?? 0);
    model.notifyDefinitionChanged?.();
    context.write(receiver, property, args[0]);
    return null;
  });
}

function registerStateCollection(registry, {owner, property, field, collection, element}) {
  registry.register({owner: x + owner, kind: 'get', name: 'get_' + property}, ({context, receiver}) => {
    const model = context.unwrapModel(receiver);
    const view = context.state(receiver, 'stateCollection:' + field, () => new ResourceModelCollection({owner: receiver,
      read: () => model[field], write: values => {
        const previous = model[field];
        model[field] = values;
        try { model.notifyDefinitionChanged?.(); } catch (error) { model[field] = previous; throw error; }
      }, unwrap: value => element === 'Setter' ? setterModel(context, value) : element === 'StateTriggerBase'
        ? stateTriggerModel(context, value) : context.unwrapModel(value)}));
    return context.wrapModel(view, x + collection);
  });
}
