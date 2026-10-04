import {ResourceFault} from '../resources/errors.js';

/** Bridge to the existing AnimationClock; completion is delivered through completed(id) from its adapter. */
export class VisualStateAnimationAdapter {
  constructor({clock, idFor, storyboardDefinition, schedule = null}) {
    this.clock = clock;
    this.idFor = idFor;
    this.storyboardDefinition = storyboardDefinition;
    this.schedule = schedule;
    this.serial = 0;
    this.pending = new Map();
  }

  begin(storyboard, context) {
    if (!this.storyboardDefinition) throw new ResourceFault('SFSTATE004', 'Storyboard adaptation is unavailable.');
    const id = 'visual-state:' + ++this.serial;
    const definition = this.storyboardDefinition(storyboard, context);
    this.clock.begin(id, {...definition, id});
    this.schedule?.();
    return {cancel: () => { this.pending.delete(id); this.clock.stop(id); }};
  }

  transition(transition, previous, next, context, complete) {
    const id = 'visual-transition:' + ++this.serial;
    const children = [];
    for (const entry of next) {
      if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) continue;
      const target = this.idFor(entry.target);
      const from = entry.from ?? entry.store.getValue(entry.property);
      if (typeof from !== 'number' || !Number.isFinite(from)) continue;
      children.push({id: id + ':' + children.length, target, property: entry.property.name,
        from, to: entry.value, duration: transition.generatedDuration, fill: 1,
        easing: transition.generatedEasingFunction ?? {kind: 'Linear'}});
    }
    if (transition.storyboard) children.push(this.storyboardDefinition(transition.storyboard, context));
    this.pending.set(id, complete);
    this.clock.begin(id, {id, children, duration: transition.generatedDuration || undefined, fill: 1});
    this.schedule?.();
    return {cancel: () => { this.pending.delete(id); this.clock.stop(id); }};
  }

  completed(id) {
    const complete = this.pending.get(id);
    if (!complete) return;
    this.pending.delete(id);
    this.clock.stop(id);
    complete();
  }

  snapshot() { return {serial: this.serial, pending: [...this.pending]}; }
  restore(snapshot) { this.serial = snapshot.serial; this.pending = new Map(snapshot.pending); }

  dispose() {
    for (const id of this.pending.keys()) this.clock.stop(id);
    this.pending.clear();
  }
}
