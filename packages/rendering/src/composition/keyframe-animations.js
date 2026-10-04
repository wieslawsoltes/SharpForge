import {finite, vector} from './values.js';
import {sampleEasing} from '../animation/easing.js';
import {prepareValueAnimation, validateAnimationValue} from '../animation/value-sampler.js';
import {parseCompositionExpression} from './expression-parser.js';
import {evaluateCompositionExpression} from './expression-evaluator.js';
import {copyCompositionData} from './snapshot.js';
import {CompositionAnimation} from './animation-definition.js';

export class CompositionEasingFunction {
  constructor(kind, options = {}) {
    this.kind = 'CompositionEasingFunction';
    this.definition = {kind, ...options};
    if (kind === 'CubicBezier') {
      this.definition.first = vector(options.first, 2);
      this.definition.second = vector(options.second, 2);
    }
    sampleEasing(0.5, this.definition);
  }
  sample(progress) { return sampleEasing(progress, this.definition); }
  snapshot() { return copyCompositionData(this.definition); }
  restore(snapshot) { this.definition = copyCompositionData(snapshot); }
}

/** Keyframe definitions can be reused; StartAnimation captures a validated immutable plan. */
export class KeyFrameAnimation extends CompositionAnimation {
  constructor(compositor, valueKind) {
    super(compositor, valueKind + 'KeyFrameAnimation');
    this.valueKind = valueKind;
    this.Duration = 1000;
    this.DelayTime = 0;
    this.DelayBehavior = 0;
    this.IterationBehavior = 0;
    this.IterationCount = 1;
    this.Direction = 0;
    this.StopBehavior = 0;
    this.frames = new Map();
    this.listeners = new Set();
    this.closed = false;
  }
  get KeyFrameCount() { return this.frames.size; }
  InsertKeyFrame(progress, value, easing) {
    this.insert(progress, {value: validateAnimationValue(this.valueKind, value), easing: easing?.definition});
  }
  InsertExpressionKeyFrame(progress, expression, easing) {
    parseCompositionExpression(expression);
    this.insert(progress, {expression, easing: easing?.definition});
  }
  insert(progress, frame) {
    if (this.closed) throw new Error('Composition animation is disposed');
    finite(progress, 'keyframe progress', 0, 1);
    if (this.frames.size >= 4096 && !this.frames.has(progress)) throw new RangeError('Composition keyframe limit exceeded');
    sampleEasing(0.5, frame.easing);
    this.frames.set(progress, {progress, ...frame});
  }
  definition(startingValue, finalValue = startingValue) {
    if (this.closed || !this.frames.size) throw new TypeError('A live animation with keyframes is required');
    const duration = finite(this.Duration?.TotalMilliseconds ?? this.Duration, 'animation duration', 0);
    const begin = finite(this.DelayTime?.TotalMilliseconds ?? this.DelayTime, 'animation delay', 0);
    finite(this.IterationCount, 'iteration count', 1, 1000000);
    for (const [name, max] of [['Direction', 3], ['StopBehavior', 2], ['IterationBehavior', 1], ['DelayBehavior', 1]]) {
      if (!Number.isInteger(this[name]) || this[name] < 0 || this[name] > max) throw new RangeError(`Invalid animation ${name}`);
    }
    const parameters = {...this.parameters, this: {StartingValue: startingValue, FinalValue: finalValue}};
    const keyFrames = [...this.frames.values()].map(frame => ({...frame, value: frame.expression
      ? evaluateCompositionExpression(parseCompositionExpression(frame.expression), parameters) : frame.value}));
    const definition = {duration, begin, valueKind: this.valueKind, from: startingValue, to: finalValue, keyFrames,
      autoReverse: this.Direction >= 2, reverse: this.Direction === 1 || this.Direction === 3,
      holdBeforeBegin: this.DelayBehavior === 0, repeatDuration: duration * this.IterationCount,
      forever: this.IterationBehavior === 1};
    prepareValueAnimation(definition, startingValue);
    return definition;
  }
  add_Completed(listener) { this.listeners.add(listener); }
  remove_Completed(listener) { this.listeners.delete(listener); }
  snapshot() {
    const names = ['Duration', 'DelayTime', 'DelayBehavior', 'IterationBehavior', 'IterationCount', 'Direction', 'StopBehavior', 'Target'];
    return {base: super.snapshot(), properties: Object.fromEntries(names.map(name => [name, copyCompositionData(this[name])])),
      frames: copyCompositionData(this.frames), parameters: copyCompositionData(this.parameters), listeners: [...this.listeners]};
  }
  restore(snapshot) {
    super.restore(snapshot.base);
    Object.assign(this, copyCompositionData(snapshot.properties));
    this.frames = copyCompositionData(snapshot.frames);
    this.parameters = copyCompositionData(snapshot.parameters);
    this.listeners = new Set(snapshot.listeners);
  }
  dispose() { super.dispose(); this.frames.clear(); this.listeners.clear(); }
}

export class AnimationController {
  constructor(engine, record) { this.kind = 'AnimationController'; this.engine = engine; this.record = record; }
  Pause() { this.engine.pause(this.record, true); }
  Resume() { this.engine.pause(this.record, false); }
  get Progress() {
    const state = this.engine.clock.state(this.record.id);
    return this.record.definition.duration ? state.currentTime / this.record.definition.duration : 1;
  }
  set Progress(value) {
    finite(value, 'animation progress', 0, 1);
    this.engine.clock.seek(this.record.id, this.record.definition.begin + this.record.definition.duration * value);
  }
  get PlaybackRate() { return this.record.playbackRate; }
  set PlaybackRate(value) {
    this.record.playbackRate = finite(value, 'playback rate', 0, 1000);
    this.engine.schedule();
  }
  retainedValues() { return [this.record.target, this.record.animation]; }
  snapshot() { return {id: this.record.id}; }
  restore(snapshot) {
    const record = this.engine.byId.get(snapshot.id);
    if (record) this.record = record;
  }
}
