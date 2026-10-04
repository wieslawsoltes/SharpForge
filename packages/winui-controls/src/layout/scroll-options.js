export const ScrollingAnimationMode = Object.freeze({ Disabled: 0, Enabled: 1, Auto: 2 });
export const ScrollingSnapPointsMode = Object.freeze({ Default: 0, Ignore: 1 });
export const ScrollSnapPointsAlignment = Object.freeze({ Near: 0, Center: 1, Far: 2 });
export const ScrollingContentOrientation = Object.freeze({ Vertical: 0, Horizontal: 1, None: 2, Both: 3 });

function enumValue(value, values, fallback) {
  const result = typeof value === 'string' ? values[value] : value ?? fallback;
  if (!Object.values(values).includes(result)) throw new RangeError('SFUI1673: Invalid scrolling option');
  return result;
}
export function normalizeScrollOptions(value = {}) {
  if (!value || typeof value !== 'object') throw new TypeError('SFUI1673: Scrolling options require an object');
  return { animationMode: enumValue(value.animationMode ?? value.AnimationMode, ScrollingAnimationMode, 2),
    snapPointsMode: enumValue(value.snapPointsMode ?? value.SnapPointsMode, ScrollingSnapPointsMode, 0) };
}

/** Snap values use unscaled content DIPs. Alignment is resolved against the current viewport before nearest-point selection. */
export function normalizeSnapPoint(value, viewport = 0) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('SFUI1673: Snap point must be finite');
    return value;
  }
  const properties = value?.properties ?? value;
  if (!properties || typeof properties !== 'object') throw new TypeError('SFUI1673: Invalid snap point');
  const alignment = enumValue(properties.Alignment ?? properties.alignment, ScrollSnapPointsAlignment, 0);
  const shift = alignment === 1 ? viewport / 2 : alignment === 2 ? viewport : 0;
  const point = properties.Value ?? properties.value;
  if (point != null) {
    if (!Number.isFinite(point)) throw new TypeError('SFUI1673: Snap point must be finite');
    return point - shift;
  }
  const offset = properties.Offset ?? properties.offset ?? 0, interval = properties.Interval ?? properties.interval;
  const start = properties.Start ?? properties.start ?? 0, end = properties.End ?? properties.end ?? Infinity;
  if (!Number.isFinite(offset) || !Number.isFinite(interval) || interval <= 0 || !Number.isFinite(start)
    || end !== Infinity && !Number.isFinite(end) || start > end) throw new TypeError('SFUI1673: Invalid repeated snap point');
  return { offset: offset - shift, interval, start: start - shift, end: end - shift };
}

export function sceneSnapPoints(node, property, resolve, viewport = 0) {
  const values = node.collections?.[property] ?? node.properties[property] ?? [];
  if (!Array.isArray(values) || values.length > 2048) throw new RangeError('SFUI1673: Snap point collection limit');
  return values.map(value => normalizeSnapPoint(value?.$ref ? resolve(value.$ref) : value, viewport));
}
