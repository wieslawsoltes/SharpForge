import {AnimationController} from '../composition/keyframe-animations.js';
import {evaluateCompositionExpression} from '../composition/expression-evaluator.js';
import {copyCompositionData} from '../composition/snapshot.js';
import {prepareValueAnimation, sampleValueAnimation} from './value-sampler.js';

/** Typed composition animations use the same injected timeline clock as XAML animations. */
export class CompositionAnimationEngine {
  constructor(compositor, {clockFactory} = {}) {
    this.compositor = compositor;
    this.clockFactory = clockFactory;
    this.clock = null;
    this.records = new Map();
    this.byId = new Map();
    this.batches = new Set();
    this.serial = 0;
    this.closed = false;
  }

  ensureClock() {
    if (this.clock) return;
    if (!this.clockFactory) throw new TypeError('An application AnimationClock factory is required');
    this.clock = this.clockFactory({
      key: id => id,
      read: id => { const record = this.byId.get(id); return record.target.get(record.property); },
      readBase: id => { const record = this.byId.get(id); return record.target.baseValues[record.property]; },
      validate: id => { if (!this.byId.has(id)) throw new TypeError('Unknown composition animation target'); },
      write: (id, property, value) => {
        const record = this.byId.get(id);
        record.target.setAnimated(record.property, value);
      },
      clear: id => { const record = this.byId.get(id); record?.target.clearAnimated(record.property); },
      completed: id => this.complete(this.byId.get(id))
    });
  }

  key(target, property) { return target.id + ':' + property; }

  start(target, property, animation, options = {}) {
    if (this.closed || target?.Compositor !== this.compositor || animation?.Compositor !== this.compositor || target.closed || animation.closed) {
      throw new TypeError('Animation and target must belong to this live Compositor');
    }
    if (animation.animations) {
      const plans = animation.animations.map(item => ({item, property: item.Target || property}));
      for (const plan of plans) this.prepare(target, plan.property, plan.item, options);
      return plans.map(plan => this.start(target, plan.property, plan.item, options));
    }
    const definition = this.prepare(target, property, animation, options);
    const key = this.key(target, property);
    const id = 'composition:' + ++this.serial;
    const record = {id, key, target, property, animation, definition, completed: false, stopped: false, playbackRate: 1,
      batches: [...this.batches], expression: definition.ast ? definition : null, startingValue: target.get(property),
      stopBehavior: animation.StopBehavior ?? 0, initializing: true, pendingCompletion: false};
    if (!record.expression) this.ensureClock();
    this.stop(target, property);
    this.records.set(key, record);
    this.byId.set(id, record);
    for (const batch of record.batches) batch.track(record);
    if (record.expression) target.setAnimated(property, evaluateCompositionExpression(definition.ast, definition.parameters));
    else this.clock.begin(id, {...definition, id, target: id, property});
    this.compositor.transport?.animationStarted(record);
    record.initializing = false;
    if (record.pendingCompletion) this.complete(record);
    this.schedule();
    return this.controller(target, property);
  }

  prepare(target, property, animation, options) {
    const startingValue = options.startingValue ?? target.get(property);
    const finalValue = options.finalValue ?? target.baseValues[property];
    const definition = animation.compile
      ? animation.compile({StartingValue: startingValue, FinalValue: finalValue}) : animation.definition(startingValue, finalValue);
    if (definition.ast) target.validate(property, evaluateCompositionExpression(definition.ast, definition.parameters));
    else for (const frame of definition.keyFrames) target.validate(property, frame.value);
    return definition;
  }

  /** Transient XAML transitions reveal their underlying base; public StopAnimation retains its declared stop policy. */
  stop(target, property, {restoreBase = false} = {}) {
    const key = this.key(target, property);
    const record = this.records.get(key);
    if (!record) return;
    const current = target.get(property), base = target.baseValues[property];
    record.stopped = true;
    if (!record.expression) this.clock.stop(record.id);
    let finalValue = restoreBase ? base : current;
    if (!restoreBase && record.stopBehavior === 1) finalValue = record.startingValue;
    if (!restoreBase && record.stopBehavior === 2 && !record.expression) finalValue =
      sampleValueAnimation(prepareValueAnimation(record.definition, record.startingValue), 1);
    target.clearAnimated(property);
    target.baseValues[property] = target.validate(property, finalValue);
    target.changed(property);
    this.complete(record);
    this.records.delete(key);
    this.byId.delete(record.id);
    this.compositor.transport?.animationStopped(record, {restoreBase});
    this.schedule();
  }

  complete(record) {
    if (!record || record.completed) return;
    if (record.initializing) { record.pendingCompletion = true; return; }
    record.completed = true;
    for (const batch of record.batches) batch.settled(record);
    this.schedule();
    for (const listener of record.animation.listeners ?? []) listener(record.animation, {});
  }

  advance(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError('Invalid animation elapsed time');
    if (this.closed) return;
    for (const record of this.records.values()) {
      if (record.expression) {
        record.target.setAnimated(record.property, evaluateCompositionExpression(record.expression.ast, record.expression.parameters));
      } else if (record.playbackRate !== 1 && !this.clock.state(record.id).paused) {
        const state = this.clock.state(record.id);
        this.clock.seek(record.id, state.time + milliseconds * record.playbackRate);
      }
    }
    if (this.clock) {
      const paused = [];
      for (const record of this.records.values()) {
        if (!record.expression && record.playbackRate !== 1 && !this.clock.state(record.id).paused) { this.clock.pause(record.id); paused.push(record.id); }
      }
      this.clock.advance(milliseconds);
      for (const id of paused) this.clock.resume(id);
    }
    this.schedule();
  }

  controller(target, property) {
    const record = this.records.get(this.key(target, property));
    if (!record || record.expression) return null;
    return record.controller ??= new AnimationController(this, record);
  }
  pause(record, paused) { if (paused) this.clock.pause(record.id); else this.clock.resume(record.id); this.schedule(); }
  schedule() {
    const running = [...this.records.values()].some(record => !record.stopped && (record.expression
      || !record.completed && record.playbackRate > 0 && !this.clock?.state(record.id).paused));
    this.compositor.scheduler?.setContinuous(this.compositor, running);
  }
  stopAll(target) { for (const record of [...this.records.values()]) if (record.target === target) this.stop(target, record.property); }
  *retainedValues() {
    for (const record of this.records.values()) if (!record.completed && !record.stopped) {
      yield record.target;
      yield record.animation;
      yield* record.batches;
    }
  }
  snapshot() {
    const batches = new Set(this.batches);
    for (const record of this.records.values()) for (const batch of record.batches) batches.add(batch);
    return {serial: this.serial, batches: [...this.batches], batchStates: [...batches].map(batch => [batch, batch.snapshot()]), clock: this.clock?.snapshot(), records: [...this.records.values()].map(record => {
      const {controller, ...data} = record;
      return copyCompositionData(data);
    })};
  }
  restore(snapshot) {
    this.closed = false;
    this.clock?.clear();
    this.serial = Math.max(this.serial, snapshot.serial);
    const records = snapshot.records.map(record => copyCompositionData(record));
    this.records = new Map(records.map(record => [record.key, record]));
    this.byId = new Map(records.map(record => [record.id, record]));
    this.batches = new Set(snapshot.batches ?? []);
    for (const [batch, state] of snapshot.batchStates ?? []) batch.restore(state);
    for (const record of records) for (const batch of record.batches) {
      batch.pending = new Set([...batch.pending].map(previous => this.byId.get(previous.id) ?? previous));
    }
    if (snapshot.clock) { this.ensureClock(); this.clock.restore(snapshot.clock); this.clock.apply(); }
    this.schedule();
  }
  dispose() {
    if (this.closed) return;
    for (const record of [...this.records.values()]) this.stop(record.target, record.property);
    this.closed = true;
    this.clock?.clear();
    this.records.clear();
    this.byId.clear();
    for (const batch of this.batches) batch.dispose();
  }
}
