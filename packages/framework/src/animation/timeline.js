import {prepareValueAnimation} from '@sharpforge/rendering';

export function finiteTime(value, name, min = 0, max = 1e12) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`Invalid ${name}`);
  return value;
}

/** Compile immutable timing/value data before changing any active state. */
export function prepareTimeline(definition, read, validate, {maxNodes = 512, maxDepth = 16} = {}) {
  let count = 0;
  const visiting = new Set();
  const prepare = (value, depth) => {
    if (!value || depth > maxDepth || ++count > maxNodes) throw new RangeError('Timeline size/depth limit exceeded');
    if (visiting.has(value.id)) throw new TypeError('Timeline cycle or duplicate child');
    visiting.add(value.id);
    const children = (value.children ?? []).map(child => prepare(child, depth + 1));
    const begin = finiteTime(value.begin ?? 0, 'BeginTime');
    const speed = finiteTime(value.speed ?? 1, 'SpeedRatio', Number.MIN_VALUE, 1000);
    const repeat = finiteTime(value.repeat ?? 1, 'repeat count', 0, 1e6);
    const fill = value.fill ?? 0;
    if (![0, 1].includes(fill)) throw new RangeError('Invalid FillBehavior');
    const duration = value.duration ?? (children.length ? Math.max(0, ...children.map(child => child.end)) : 1000);
    if (duration !== Infinity) finiteTime(duration, 'Duration');
    const autoReverse = !!value.autoReverse;
    const cycle = duration * (autoReverse ? 2 : 1);
    const active = value.forever ? Infinity : value.repeatDuration !== undefined
      ? finiteTime(value.repeatDuration, 'repeat duration') : (repeat === 0 ? 0 : cycle * repeat);
    const plan = {id: value.id, ref: value.ref, children, begin, speed, repeat, fill, holdBeforeBegin: !!value.holdBeforeBegin,
      duration, autoReverse, active, end: begin + active / speed};
    if (value.target !== undefined) {
      validate(value.target, value.property, value.valueKind ?? 'Double');
      if (duration === Infinity) throw new TypeError('A value animation requires a finite simple duration');
      plan.target = value.target;
      plan.property = value.property;
      Object.assign(plan, prepareValueAnimation({...value, duration}, read(value.target, value.property)));
    }
    return plan;
  };
  return prepare(definition, 0);
}

export function timelinePosition(plan, time) {
  const elapsed = (time - plan.begin) * plan.speed;
  if (elapsed < 0) return {contributes: !!plan.holdBeforeBegin, complete: false, local: 0, progress: 0, state: 2};
  const complete = elapsed >= plan.active;
  if (complete && plan.fill === 1) return {contributes: false, complete: true, local: 0, progress: 0, state: 2};
  if (plan.active === 0) return {contributes: plan.fill === 0, complete: true, local: 0, progress: 1, state: plan.fill === 0 ? 1 : 2};
  const at = complete ? plan.active : elapsed;
  if (plan.duration === Infinity) return {contributes: true, complete, local: at, progress: 0, state: complete ? 1 : 0};
  const cycle = plan.duration * (plan.autoReverse ? 2 : 1);
  let local = cycle === 0 ? plan.duration : at % cycle;
  if (complete && at > 0 && local === 0) local = cycle;
  if (plan.autoReverse && local > plan.duration) local = 2 * plan.duration - local;
  return {contributes: true, complete, local, progress: plan.duration === 0 ? 1 : local / plan.duration, state: complete ? 1 : 0};
}

export function walkTimeline(plan, visit) {
  visit(plan);
  for (const child of plan.children) walkTimeline(child, visit);
}
