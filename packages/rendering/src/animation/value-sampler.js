import {sampleEasing} from './easing.js';

const fields = Object.freeze({Point: ['X', 'Y'], Vector2: ['X', 'Y'], Vector3: ['X', 'Y', 'Z'],
  Vector4: ['X', 'Y', 'Z', 'W'], Quaternion: ['X', 'Y', 'Z', 'W'], Color: ['R', 'G', 'B', 'A']});

function components(kind, value) {
  const names = fields[kind];
  if (!names) throw new TypeError(`Unsupported animation value kind: ${kind}`);
  const values = Array.isArray(value) ? value : names.map(name => value?.[name]);
  if (values.length !== names.length || !values.every(Number.isFinite)) throw new TypeError(`Invalid ${kind} animation value`);
  if (kind === 'Quaternion' && Math.hypot(...values) < 1e-12) throw new RangeError('A quaternion must be nonzero');
  return values;
}

export function validateAnimationValue(kind, value) {
  if (kind === 'Object') return value;
  if (kind === 'Scalar' || kind === 'Double') {
    if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw new RangeError('Invalid numeric animation value');
    return value;
  }
  components(kind, value);
  return value;
}

function reconstruct(kind, template, values) {
  if (Array.isArray(template)) return values;
  const result = {...template};
  fields[kind].forEach((field, index) => {
    result[field] = kind === 'Color' ? Math.round(Math.max(0, Math.min(255, values[index]))) : values[index];
  });
  return result;
}

export function interpolateValue(kind, from, to, progress) {
  if (kind === 'Object') return progress < 1 ? from : to;
  if (kind === 'Scalar' || kind === 'Double') return from + (to - from) * progress;
  const first = components(kind, from);
  let second = components(kind, to);
  if (kind === 'Quaternion') {
    const firstLength = Math.hypot(...first);
    const secondLength = Math.hypot(...second);
    const left = first.map(value => value / firstLength);
    second = second.map(value => value / secondLength);
    let dot = left.reduce((sum, value, index) => sum + value * second[index], 0);
    if (dot < 0) { second = second.map(value => -value); dot = -dot; }
    const angle = Math.acos(Math.min(1, dot));
    const denominator = Math.sin(angle);
    const leftWeight = denominator > 1e-6 ? Math.sin((1 - progress) * angle) / denominator : 1 - progress;
    const rightWeight = denominator > 1e-6 ? Math.sin(progress * angle) / denominator : progress;
    const result = left.map((value, index) => value * leftWeight + second[index] * rightWeight);
    const length = Math.hypot(...result);
    return reconstruct(kind, from, result.map(value => value / length));
  }
  return reconstruct(kind, from, first.map((value, index) => value + (second[index] - value) * progress));
}

function addValue(kind, left, right) {
  if (kind === 'Scalar' || kind === 'Double') return left + right;
  if (kind === 'Object' || kind === 'Quaternion') throw new TypeError(`By is not supported for ${kind}`);
  const first = components(kind, left);
  const second = components(kind, right);
  return reconstruct(kind, left, first.map((value, index) => value + second[index]));
}

/** Validate completely before an active timeline can be replaced; result contains only snapshot-safe data. */
export function prepareValueAnimation(definition, base) {
  const kind = definition.valueKind ?? 'Double';
  const from = validateAnimationValue(kind, definition.from ?? base);
  const target = definition.to ?? (definition.by !== undefined ? addValue(kind, from, definition.by) : base);
  const to = validateAnimationValue(kind, target);
  const easing = definition.easing ?? {kind: 'Linear'};
  sampleEasing(0.5, easing);
  const keyFrames = definition.keyFrames?.map((frame, index) => {
    const progress = frame.progress ?? (definition.duration ? frame.time / definition.duration : 1);
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new RangeError('Invalid keyframe time');
    const frameEasing = frame.easing ?? {kind: 'Linear'};
    sampleEasing(0.5, frameEasing);
    return {progress, value: validateAnimationValue(kind, frame.value), discrete: !!frame.discrete || kind === 'Object', easing: frameEasing, index};
  }).sort((first, second) => first.progress - second.progress || first.index - second.index);
  if (keyFrames?.length > 4096) throw new RangeError('Animation keyframe count limit exceeded');
  return {valueKind: kind, from, to, easing, keyFrames, reverse: !!definition.reverse};
}

export function sampleValueAnimation(plan, progress) {
  if (plan.reverse) progress = 1 - progress;
  const frames = plan.keyFrames;
  if (!frames?.length) return interpolateValue(plan.valueKind, plan.from, plan.to, sampleEasing(progress, plan.easing));
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (frames[middle].progress <= progress) low = middle + 1;
    else high = middle;
  }
  if (low === frames.length) return frames.at(-1).value;
  const previous = low ? frames[low - 1] : {progress: 0, value: plan.from};
  const next = frames[low];
  if (next.discrete) return previous.value;
  const fraction = (progress - previous.progress) / (next.progress - previous.progress);
  return interpolateValue(plan.valueKind, previous.value, next.value, sampleEasing(Math.max(0, fraction), next.easing));
}
