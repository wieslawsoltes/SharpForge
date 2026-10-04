import {sampleValueAnimation} from '@sharpforge/rendering';
import {finiteTime, prepareTimeline, timelinePosition, walkTimeline} from './timeline.js';

/** One deterministic timeline clock shared by managed, JavaScript and composition adapters. */
export class AnimationClock {
  constructor(adapter) {
    this.adapter = adapter;
    this.states = new Map();
    this.bases = new Map();
    this.serial = 0;
    this.applying = false;
    this.values = new Map();
    this.used = new Set();
    this.events = [];
  }

  key(target, property) { return this.adapter.key(target) + '|' + property; }
  get running() {
    for (const state of this.states.values()) if (!state.paused && state.time < state.plan.end) return true;
    return false;
  }
  getBase(target, property) {
    return this.adapter.readBase ? this.adapter.readBase(target, property)
      : this.bases.get(this.key(target, property))?.value ?? this.adapter.read(target, property);
  }
  setBase(target, property, value) {
    if (this.applying) return false;
    const base = this.bases.get(this.key(target, property));
    if (!base) return false;
    base.value = value;
    this.apply();
    return true;
  }

  begin(id, definition) {
    const plan = prepareTimeline(definition, (target, property) => this.adapter.read(target, property), this.adapter.validate);
    if (!this.states.has(id) && this.states.size >= 128) throw new RangeError('Active storyboard limit exceeded');
    walkTimeline(plan, node => {
      if (node.target === undefined) return;
      const key = this.key(node.target, node.property);
      if (!this.bases.has(key)) this.bases.set(key, {target: node.target, property: node.property,
        value: this.getBase(node.target, node.property)});
    });
    this.states.delete(id);
    this.states.set(id, {plan, time: 0, paused: false, status: 0, serial: ++this.serial, completed: []});
    this.apply();
    return this.states.get(id);
  }
  pause(id) { const state = this.states.get(id); if (state) state.paused = true; }
  resume(id) { const state = this.states.get(id); if (state) state.paused = false; }
  stop(id) { if (this.states.delete(id)) this.apply(); }
  seek(id, time) {
    finiteTime(time, 'seek time');
    const state = this.states.get(id);
    if (!state) throw new Error('Begin the storyboard before seeking');
    state.time = time;
    this.apply();
  }
  skipToFill(id) {
    const state = this.states.get(id);
    if (!state) return;
    if (state.plan.end === Infinity) throw new Error('A repeating-forever storyboard cannot skip to fill');
    state.time = state.plan.end;
    this.apply();
  }
  advance(delta) {
    finiteTime(delta, 'animation delta');
    for (const state of this.states.values()) if (!state.paused && state.time < state.plan.end) state.time += delta;
    this.apply();
  }

  sample(state, node, time, inherited = true) {
    const position = timelinePosition(node, time);
    const active = inherited && position.contributes;
    if (node === state.plan) state.status = position.state;
    if (inherited && position.complete && !state.completed.includes(node.id)) {
      state.completed.push(node.id);
      this.events.push(node.ref ?? node.id);
    }
    if (node.target !== undefined) {
      const key = this.key(node.target, node.property);
      this.used.add(key);
      if (active) this.values.set(key, sampleValueAnimation(node, position.progress));
    }
    for (const child of node.children) this.sample(state, child, position.local, active);
  }

  apply() {
    if (this.applying) return;
    this.applying = true;
    this.values.clear();
    this.used.clear();
    this.events.length = 0;
    try {
      for (const state of this.states.values()) this.sample(state, state.plan, state.time);
      for (const [key, base] of this.bases) {
        const contributes = this.values.has(key);
        const value = contributes ? this.values.get(key) : this.getBase(base.target, base.property);
        if (!contributes && this.adapter.clear) this.adapter.clear(base.target, base.property);
        else if (!(this.adapter.equals ?? Object.is)(this.adapter.read(base.target, base.property), value)) {
          this.adapter.write(base.target, base.property, value);
        }
        if (!this.used.has(key)) this.bases.delete(key);
      }
    } finally {
      this.applying = false;
    }
    const events = this.events.slice();
    this.events.length = 0;
    for (const event of events) this.adapter.completed?.(event);
  }

  state(id) {
    const state = this.states.get(id);
    return state ? {time: state.time, currentTime: timelinePosition(state.plan, state.time).local, state: state.status, paused: state.paused}
      : {time: 0, currentTime: 0, state: 2, paused: false};
  }
  snapshot() { return structuredClone({states: [...this.states], bases: [...this.bases], serial: this.serial}); }
  restore(snapshot) {
    this.states = new Map(structuredClone(snapshot?.states ?? []));
    this.bases = new Map(structuredClone(snapshot?.bases ?? []));
    this.serial = Math.max(this.serial, snapshot?.serial ?? 0);
  }
  *roots() {
    for (const state of this.states.values()) {
      const references = [];
      walkTimeline(state.plan, node => {
        if (node.ref) references.push(node.ref);
        if (node.target) references.push(node.target);
        references.push(node.from, node.to, ...(node.keyFrames ?? []).map(frame => frame.value));
      });
      yield* references;
    }
    for (const base of this.bases.values()) { yield base.target; yield base.value; }
  }
  clear() { this.states.clear(); this.apply(); }
}
