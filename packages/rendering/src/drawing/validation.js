import {DrawOp, DrawingError, finite, matrix, rectangle, radii, resource} from './commands.js';
import {parseColor} from '../media/colors.js';

const point = value => {
  if (!Array.isArray(value) || value.length !== 2) throw new DrawingError('SFRENDER002', 'A drawing point needs two coordinates');
  return value.map(item => finite(item));
};
const requireResource = (value, kind) => {
  if (value == null) throw new DrawingError('SFRENDER005', `Missing ${kind} resource`);
  return resource(value, kind);
};

/** Validate untrusted wire commands through the same argument rules used by DrawingContext. */
export function validateCommand(command) {
  const value = {...command};
  if (value.op === DrawOp.PushTransform) value.transform = matrix(value.transform);
  else if (value.op === DrawOp.PushClip) value.geometry = requireResource(value.geometry, 'geometry');
  else if (value.op === DrawOp.PushOpacity) {
    value.opacity = finite(value.opacity, 'opacity', 0, 1); if (value.bounds) value.bounds = rectangle(value.bounds);
  } else if (value.op === DrawOp.Clear) value.color = parseColor(value.color);
  else if ([DrawOp.Rectangle, DrawOp.RoundedRectangle, DrawOp.Ellipse].includes(value.op)) {
    value.rect = rectangle(value.rect);
    if (value.op === DrawOp.RoundedRectangle) value.radii = radii(value.radii, value.rect);
  } else if (value.op === DrawOp.Line) { value.start = point(value.start); value.end = point(value.end); }
  else if (value.op === DrawOp.Geometry) value.geometry = requireResource(value.geometry, 'geometry');
  else if (value.op === DrawOp.GlyphRun) { value.run = requireResource(value.run, 'glyphRun'); value.origin = point(value.origin); }
  else if (value.op === DrawOp.Image) { value.image = requireResource(value.image, 'image'); value.destination = rectangle(value.destination); }
  else if (value.op === DrawOp.Layer) value.layer = requireResource(value.layer, 'layer');
  if (value.brush != null) value.brush = resource(value.brush, 'brush');
  if (value.pen != null) value.pen = resource(value.pen, 'pen');
  if (value.options) {
    const options = {...value.options};
    if (options.source) options.source = rectangle(options.source);
    if (options.destination) options.destination = rectangle(options.destination);
    if (options.opacity != null) options.opacity = finite(options.opacity, 'opacity', 0, 1);
    if (options.transform) options.transform = matrix(options.transform);
    if (options.sampling && !['linear', 'nearest'].includes(options.sampling)) throw new DrawingError('SFRENDER005', 'Unknown sampling mode');
    value.options = options;
  }
  return value;
}

/** Copy and freeze data; opaque native image/font resources remain references and require handles for serialization. */
export function snapshotDrawing(value, active = new Set(), copied = new Map(), depth = 0) {
  if (value == null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
      throw new DrawingError('SFRENDER016', 'Drawing commands contain non-data values');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) throw new DrawingError('SFRENDER016', 'Drawing data contains a non-finite number');
    return value;
  }
  if (active.has(value) || depth > 64) throw new DrawingError('SFRENDER016', 'Drawing data cycle or nesting budget exceeded');
  if (copied.has(value)) return copied.get(value);
  if (typeof value.getContext === 'function' || typeof value.close === 'function' || value.nodeType) return value;
  active.add(value);
  const result = Array.isArray(value) || ArrayBuffer.isView(value) ? [] : {};
  copied.set(value, result);
  for (const [key, child] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new DrawingError('SFRENDER016', 'Invalid drawing data key');
    if (child !== undefined) result[key] = snapshotDrawing(child, active, copied, depth + 1);
  }
  active.delete(value); return Object.freeze(result);
}

export function serializeDrawingValue(key, value) {
  if (value && typeof value === 'object' && (typeof value.getContext === 'function' || typeof value.close === 'function' || value.nodeType)) {
    throw new DrawingError('SFRENDER017', 'Opaque resources must be registered before serializing a display list');
  }
  return value;
}
