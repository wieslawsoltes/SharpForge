/** Declarative state data contains no control instances and is safe to share until attached. */
export class VisualState {
  constructor(name, {setters = [], storyboard = null, triggers = []} = {}) {
    if (typeof name !== 'string' || !name) throw new TypeError('A visual state name is required.');
    this.name = name;
    this.setters = stateList(setters, 16384, 'Visual state setter');
    this.storyboard = storyboard;
    this.triggers = stateList(triggers, 1024, 'Visual state trigger');
    this.definitionListeners = new Set();
  }

  subscribeDefinition(listener) { this.definitionListeners.add(listener); return () => this.definitionListeners.delete(listener); }
  notifyDefinitionChanged() { for (const listener of [...this.definitionListeners]) listener(); }

  snapshot() {
    return {name: this.name, storyboard: this.storyboard, definitionListeners: [...this.definitionListeners],
      setters: this.setters.map(setter => ({setter, state: setter.snapshot()})),
      triggers: this.triggers.map(trigger => ({trigger, state: trigger.snapshot()}))};
  }

  restore(snapshot) {
    this.name = snapshot.name;
    this.definitionListeners = new Set(snapshot.definitionListeners ?? []);
    this.storyboard = snapshot.storyboard;
    this.setters = snapshot.setters.map(saved => { saved.setter.restore(saved.state); return saved.setter; });
    this.triggers = snapshot.triggers.map(saved => { saved.trigger.restore(saved.state); return saved.trigger; });
  }

  *retainedValues() {
    yield this.storyboard;
    for (const setter of this.setters) yield* setter.retainedValues();
    for (const trigger of this.triggers) yield* trigger.retainedValues();
    for (const listener of this.definitionListeners) if (listener.retainedValues) yield* listener.retainedValues();
  }
}

export class VisualTransition {
  constructor({from = null, to = null, generatedDuration = 0, generatedEasingFunction = null, storyboard = null} = {}) {
    if (!Number.isFinite(generatedDuration) || generatedDuration < 0) throw new RangeError('Transition duration is milliseconds >= 0.');
    Object.assign(this, {from, to, generatedDuration, generatedEasingFunction, storyboard});
  }

  snapshot() {
    return {from: this.from, to: this.to, generatedDuration: this.generatedDuration,
      generatedEasingFunction: this.generatedEasingFunction, storyboard: this.storyboard};
  }

  restore(snapshot) { Object.assign(this, snapshot); }
  *retainedValues() { yield this.storyboard; yield this.generatedEasingFunction; }
}

export class VisualStateGroup {
  constructor(name, {states = [], transitions = []} = {}) {
    this.name = name;
    this.states = stateList(states, 4096, 'Visual state');
    this.transitions = stateList(transitions, 4096, 'Visual transition');
    this.currentState = null;
    this.changing = new Set();
    this.changed = new Set();
    this.definitionListeners = new Set();
    const names = new Set();
    for (const state of this.states) {
      if (names.has(state.name)) throw new TypeError('Duplicate visual state name in a group.');
      names.add(state.name);
    }
  }

  onCurrentStateChanging(listener) { this.changing.add(listener); return () => this.changing.delete(listener); }
  onCurrentStateChanged(listener) { this.changed.add(listener); return () => this.changed.delete(listener); }
  subscribeDefinition(listener) { this.definitionListeners.add(listener); return () => this.definitionListeners.delete(listener); }
  notifyDefinitionChanged() { for (const listener of [...this.definitionListeners]) listener(); }

  snapshot() {
    return {name: this.name, currentState: this.currentState, changing: [...this.changing], changed: [...this.changed],
      definitionListeners: [...this.definitionListeners],
      states: this.states.map(state => ({state, snapshot: state.snapshot()})),
      transitions: this.transitions.map(transition => ({transition, snapshot: transition.snapshot()}))};
  }

  restore(snapshot) {
    this.name = snapshot.name;
    this.currentState = snapshot.currentState;
    this.changing = new Set(snapshot.changing);
    this.changed = new Set(snapshot.changed);
    this.definitionListeners = new Set(snapshot.definitionListeners ?? []);
    this.states = snapshot.states.map(saved => { saved.state.restore(saved.snapshot); return saved.state; });
    this.transitions = snapshot.transitions.map(saved => { saved.transition.restore(saved.snapshot); return saved.transition; });
  }

  *retainedValues() {
    for (const state of this.states) yield* state.retainedValues();
    for (const transition of this.transitions) yield* transition.retainedValues();
    for (const listeners of [this.changing, this.changed, this.definitionListeners]) {
      for (const listener of listeners) if (listener.retainedValues) yield* listener.retainedValues();
    }
  }

  transition(from, to) {
    let best = null;
    let specificity = -1;
    for (const candidate of this.transitions) {
      if (candidate.from && candidate.from !== from?.name || candidate.to && candidate.to !== to?.name) continue;
      const score = (candidate.from ? 1 : 0) + (candidate.to ? 2 : 0);
      if (score > specificity) { best = candidate; specificity = score; }
    }
    return best;
  }
}
import {stateList} from './state-limits.js';
