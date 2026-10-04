/** Stable internal display-list wire format. These IDs are not managed framework ABI IDs. */
export const DISPLAY_LIST_VERSION = 1;
export const DrawOp = Object.freeze({
  PushTransform: 1, PushClip: 2, PushOpacity: 3, Pop: 4,
  Rectangle: 16, RoundedRectangle: 17, Ellipse: 18, Line: 19,
  Geometry: 20, GlyphRun: 21, Image: 22, Layer: 23, Clear: 24
});
export const drawOpNames = Object.freeze(Object.fromEntries(Object.entries(DrawOp).map(([name, id]) => [id, name])));

/** A stable diagnostic with optional command/input offset; never silently drops malformed drawing. */
export class DrawingError extends Error {
  constructor(code, message, offset = null) {
    super(message);
    this.name = 'DrawingError';
    this.code = code;
    this.offset = offset;
  }
}

/** Validate finite drawing coordinates in logical device-independent pixels. */
export function finite(value, label = 'coordinate', minimum = -1e9, maximum = 1e9) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new DrawingError('SFRENDER001', `${label} must be finite in [${minimum}, ${maximum}]`);
  }
  return value;
}

export function rectangle(value) {
  const rect = Array.isArray(value) ? value : [value?.x ?? value?.X, value?.y ?? value?.Y,
    value?.width ?? value?.Width ?? value?.w, value?.height ?? value?.Height ?? value?.h];
  if (rect.length !== 4) throw new DrawingError('SFRENDER002', 'A rectangle needs four coordinates');
  return [finite(rect[0]), finite(rect[1]), finite(rect[2], 'width', 0), finite(rect[3], 'height', 0)];
}

export function matrix(value) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== 6) {
    throw new DrawingError('SFRENDER003', 'A 2D transform needs six coefficients');
  }
  return Array.from(value, item => finite(item, 'matrix coefficient'));
}

export function radii(value, rect) {
  let result;
  if (typeof value === 'number') result = Array(8).fill(finite(value, 'radius', 0));
  else if (Array.isArray(value) && value.length === 2) result = [value[0], value[1], value[0], value[1],
    value[0], value[1], value[0], value[1]];
  else if (Array.isArray(value) && value.length === 4) result = value.flatMap(radius => [radius, radius]);
  else if (Array.isArray(value) && value.length === 8) result = [...value];
  else throw new DrawingError('SFRENDER004', 'Radii require a scalar, ellipse pair, four corners, or four ellipse pairs');
  result.forEach(radius => finite(radius, 'radius', 0));
  const [width, height] = [rect[2], rect[3]];
  const ratio = Math.min(1, width / (result[0] + result[2] || 1), width / (result[6] + result[4] || 1),
    height / (result[1] + result[7] || 1), height / (result[3] + result[5] || 1));
  return result.map(radius => radius * ratio);
}

/** Resource descriptors remain immutable data; actual bitmap/font objects live in ResourceTable. */
export function resource(value, kind) {
  if (value == null) return null;
  if (typeof value === 'string' && kind === 'brush') return value;
  if (typeof value !== 'object') throw new DrawingError('SFRENDER005', `Invalid ${kind} resource`);
  return value;
}

export function resolveResource(table, value, kind) {
  if (value == null || typeof value !== 'object' || value.id === undefined || value.generation === undefined) return value;
  if (!table) throw new DrawingError('SFRENDER006', 'Display list requires a resource table');
  return table.resolve(value, kind);
}
