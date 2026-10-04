import {CompositionTarget} from './composition-target.js';
import {LoadedImageSurface} from './brushes.js';
import {DrawingModel, DrawingCollection, serializeRenderingValue} from '../media/models.js';
import {PathGeometry, PathFigure, LineSegment, BezierSegment, QuadraticBezierSegment, ArcSegment,
  RectangleGeometry, EllipseGeometry, LineGeometry, GeometryGroup} from '../geometry/path-geometry.js';

const geometryTypes = Object.freeze([PathGeometry, PathFigure, LineSegment, BezierSegment, QuadraticBezierSegment, ArcSegment,
  RectangleGeometry, EllipseGeometry, LineGeometry, GeometryGroup]);
const unsafeNames = new Set(['__proto__', 'constructor', 'prototype']);

function projectedValue(value) {
  if (value instanceof LoadedImageSurface) {
    if (value.closed) throw new TypeError('Disposed image surface cannot be transported');
    return value.image;
  }
  if (value instanceof DrawingModel || value instanceof DrawingCollection) return serializeRenderingValue(value);
  if (geometryTypes.some(Type => value instanceof Type)) return {...value};
  return value;
}

function copyTyped(value, budget) {
  budget.bytes += value.byteLength;
  if (budget.bytes > 64 * 1024 * 1024) throw new RangeError('Composition transport image budget exceeded');
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (value instanceof DataView) return new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  return value.slice();
}

function copyValue(input, objects, budget, depth) {
  if (++budget.nodes > 100000 || depth > 64) throw new RangeError('Composition transport value budget exceeded');
  if (input === null || input === undefined || typeof input === 'boolean') return input ?? null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new TypeError('Composition transport rejects nonfinite values');
    return input;
  }
  if (typeof input === 'string') {
    budget.bytes += input.length * 2;
    if (input.length > 1048576 || budget.bytes > 64 * 1024 * 1024) throw new RangeError('Composition transport string budget exceeded');
    return input;
  }
  if (!objects && input instanceof CompositionTarget) {
    if (input.closed) throw new TypeError('Disposed composition reference cannot be transported');
    return {$composition: input.id};
  }
  const value = objects ? input : projectedValue(input);
  if (value !== input) return copyValue(value, objects, budget, depth + 1);
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return copyTyped(value, budget);
  if (typeof value !== 'object' || value === null || !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError('SF_COMPOSITION_TRANSFER_UNSUPPORTED: provide plain data or a decoded pixel resource');
  }
  if (budget.active.has(value)) throw new TypeError('Composition transport value cycle');
  budget.active.add(value);
  try {
    const entries = Object.getOwnPropertyDescriptors(value);
    if (objects && Object.hasOwn(entries, '$composition')) {
      const descriptor = entries.$composition;
      if (!Object.hasOwn(descriptor, 'value') || Object.keys(entries).length !== 1 || !objects.has(descriptor.value)) {
        throw new TypeError('Unknown or invalid transported composition reference');
      }
      return objects.get(descriptor.value);
    }
    const result = Array.isArray(value) ? [] : Object.create(null);
    for (const [name, descriptor] of Object.entries(entries)) {
      if (Array.isArray(value) && name === 'length') continue;
      if (unsafeNames.has(name) || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Unsafe transported property or accessor');
      result[name] = copyValue(descriptor.value, objects, budget, depth + 1);
    }
    return result;
  } finally { budget.active.delete(value); }
}

/** Serializes native geometry, decoded image pixels and explicit composition references into bounded plain data. */
export function encodeCompositionValue(value, depth = 0) {
  return copyValue(value, null, {nodes: 0, bytes: 0, active: new Set()}, depth);
}

/** Resolves validated reference tokens without evaluating accessors or accepting native classes from a worker. */
export function decodeCompositionValue(value, objects, depth = 0) {
  return copyValue(value, objects, {nodes: 0, bytes: 0, active: new Set()}, depth);
}
