const valueKinds = Object.freeze({DoubleAnimation: 'Double', ColorAnimation: 'Color', PointAnimation: 'Point',
  DoubleAnimationUsingKeyFrames: 'Double', ColorAnimationUsingKeyFrames: 'Color',
  PointAnimationUsingKeyFrames: 'Point', ObjectAnimationUsingKeyFrames: 'Object', FadeInThemeAnimation: 'Double', FadeOutThemeAnimation: 'Double'});

export function readEasing(object, adapter) {
  if (!object) return {kind: 'Linear'};
  const result = {kind: adapter.type(object).split('.').at(-1), mode: adapter.native(adapter.get(object, 'EasingMode', 0))};
  const defaults = {Power: 2, Amplitude: 1, Bounces: 3, Bounciness: 2, Oscillations: 3, Springiness: 3, Exponent: 2};
  for (const [property, value] of Object.entries(defaults)) result[property[0].toLowerCase() + property.slice(1)] =
    adapter.native(adapter.get(object, property, value));
  return result;
}

function readFrame(frame, duration, adapter, index, count) {
  const kind = adapter.type(frame).split('.').at(-1);
  const keyTime = adapter.get(frame, 'KeyTime');
  const time = keyTime ? adapter.time(adapter.get(keyTime, 'TimeSpan')) : null;
  const progress = keyTime ? adapter.native(adapter.get(keyTime, '$percent', null)) : null;
  const result = {time: time ?? undefined, progress: progress ?? (time === null ? (index + 1) / count : undefined),
    value: adapter.readValue(adapter.get(frame, 'Value')), discrete: kind.startsWith('Discrete')};
  if (kind.startsWith('Easing')) result.easing = readEasing(adapter.get(frame, 'EasingFunction'), adapter);
  if (kind.startsWith('Spline')) {
    const spline = adapter.get(frame, 'KeySpline');
    if (!spline) result.easing = {kind: 'Linear'};
    else result.easing = {kind: 'KeySpline', first: adapter.point(adapter.get(spline, 'ControlPoint1')),
      second: adapter.point(adapter.get(spline, 'ControlPoint2'))};
  }
  return result;
}

/** Shared host adapter builds data-only timeline definitions for all supported XAML value kinds. */
export function buildTimelineDefinition(root, adapter, {maxNodes = 512, maxDepth = 16} = {}) {
  const seen = new Set();
  const build = (object, depth) => {
    const id = adapter.key(object);
    if (depth > maxDepth || seen.size >= maxNodes || seen.has(id)) throw new TypeError('Invalid timeline cycle, duplicate or size limit');
    seen.add(id);
    const kind = adapter.type(object).split('.').at(-1);
    const repeat = adapter.get(object, 'RepeatBehavior');
    const definition = {id, ref: id, begin: adapter.time(adapter.get(object, 'BeginTime')) ?? 0,
      duration: adapter.duration(adapter.get(object, 'Duration')), speed: adapter.native(adapter.get(object, 'SpeedRatio', 1)),
      autoReverse: !!adapter.native(adapter.get(object, 'AutoReverse', false)), fill: adapter.native(adapter.get(object, 'FillBehavior', 0)),
      repeat: repeat ? adapter.native(adapter.get(repeat, 'Count', 1)) : 1, forever: repeat ? !!adapter.get(repeat, '$forever') : false};
    definition.ref = adapter.reference?.(object) ?? id;
    if (repeat && adapter.get(repeat, '$repeatDuration')) definition.repeatDuration = adapter.time(adapter.get(repeat, 'Duration'));
    if (kind === 'Storyboard') {
      definition.children = adapter.items(adapter.get(object, 'Children')).map(child => build(child, depth + 1));
      if (!definition.children.length && definition.duration === null) definition.duration = 0;
      return definition;
    }
    const valueKind = valueKinds[kind];
    if (!valueKind) throw new TypeError(`Unsupported XAML timeline: ${kind}`);
    const target = adapter.target(object);
    definition.target = adapter.targetKey?.(target.object) ?? target.object;
    definition.property = target.property;
    definition.valueKind = valueKind;
    if (kind.endsWith('UsingKeyFrames')) {
      const frames = adapter.items(adapter.get(object, 'KeyFrames'));
      definition.keyFrames = frames.map((frame, index) => readFrame(frame, definition.duration, adapter, index, frames.length));
      if (definition.duration === null) definition.duration = Math.max(0, ...definition.keyFrames.map(frame => frame.time ?? 0)) || 1000;
    } else {
      for (const property of ['From', 'To', 'By']) {
        if (adapter.hasValue && !adapter.hasValue(object, property)) continue;
        const value = adapter.get(object, property);
        if (value !== null && value !== undefined) definition[property.toLowerCase()] = adapter.readValue(value);
      }
      definition.easing = readEasing(adapter.get(object, 'EasingFunction'), adapter);
      if (kind === 'FadeInThemeAnimation' || kind === 'FadeOutThemeAnimation') {
        definition.from = kind === 'FadeInThemeAnimation' ? 0 : 1;
        definition.to = kind === 'FadeInThemeAnimation' ? 1 : 0;
        definition.duration ??= 180;
      }
    }
    return definition;
  };
  return build(root, 0);
}
