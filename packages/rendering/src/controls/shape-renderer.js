import {DrawingError, finite} from '../drawing/commands.js';
import {normalizeGeometry} from '../geometry/path-geometry.js';
import {geometryBounds} from '../geometry/geometry-math.js';
import {transformValue, translation, scaling, multiply, IDENTITY} from '../media/transforms.js';

const cap = value => ['butt', 'square', 'round', 'triangle'][value ?? 0];
const point = value => [value[0] ?? value.X ?? value.x, value[1] ?? value.Y ?? value.y];

export function shapePen(properties) {
  if (!properties.Stroke) return null;
  return {brush: properties.Stroke, width: finite(properties.StrokeThickness ?? 1, 'StrokeThickness', 0, 1000000),
    dash: properties.StrokeDashArray ?? [], dashOffset: properties.StrokeDashOffset ?? 0,
    dashCap: cap(properties.StrokeDashCap), startCap: cap(properties.StrokeStartLineCap), endCap: cap(properties.StrokeEndLineCap),
    join: ['miter', 'bevel', 'round'][properties.StrokeLineJoin ?? 0], miterLimit: properties.StrokeMiterLimit ?? 10};
}
export function localBounds(layout) {
  const rect = layout.rect ?? layout;
  return [0, 0, rect.width ?? rect.Width ?? layout.renderSize?.width ?? 0, rect.height ?? rect.Height ?? layout.renderSize?.height ?? 0];
}
export function shapeGeometry(node, layout, resolve = value => value) {
  const p = node.properties ?? node, type = (node.type ?? '').split('.').at(-1), rect = localBounds(layout);
  const stroke = p.Stroke ? p.StrokeThickness ?? 1 : 0, inset = stroke / 2;
  if (type === 'Rectangle' || type === 'Ellipse') return {kind: type === 'Ellipse' ? 'ellipse' : 'rectangle',
    rect: [inset, inset, Math.max(0, rect[2] - stroke), Math.max(0, rect[3] - stroke)], radii: [p.RadiusX ?? 0, p.RadiusY ?? 0]};
  if (type === 'Line') return {kind: 'path', fillRule: 'nonzero', figures: [{start: [p.X1 ?? 0, p.Y1 ?? 0],
    segments: [{kind: 'line', end: [p.X2 ?? 0, p.Y2 ?? 0]}], closed: false, filled: false}]};
  if (type === 'Polygon' || type === 'Polyline') {
    let source = node.collections?.Points ?? p.Points ?? [];
    if (typeof source === 'string') {
      const numbers = source.trim().split(/[\s,]+/).map(Number);
      if (numbers.length % 2 || numbers.some(value => !Number.isFinite(value))) throw new DrawingError('SFRENDER110', 'PointCollection requires x,y pairs');
      source = Array.from({length: numbers.length / 2}, (_, index) => numbers.slice(index * 2, index * 2 + 2));
    }
    const points = source.map(item => point(resolve(item) ?? item));
    return {kind: 'path', fillRule: p.FillRule === 1 ? 'nonzero' : 'evenodd', figures: points.length ?
      [{start: points[0], segments: points.slice(1).map(end => ({kind: 'line', end})), closed: type === 'Polygon', filled: true}] : []};
  }
  if (type === 'Path' || type === 'PathIcon') return normalizeGeometry(p.Data, resolve);
  throw new DrawingError('SFRENDER110', `No shape geometry for ${type}`);
}

export function shapeStretch(geometry, layout, properties) {
  const [x, y, width, height] = geometryBounds(geometry), target = localBounds(layout);
  const stretch = properties.Stretch ?? 0, stroke = properties.Stroke ? properties.StrokeThickness ?? 1 : 0;
  if (!stretch || !width || !height) return IDENTITY;
  let sx = Math.max(0, target[2] - stroke) / width, sy = Math.max(0, target[3] - stroke) / height;
  if (stretch === 2 || stretch === 3) sx = sy = (stretch === 2 ? Math.min : Math.max)(sx, sy);
  return multiply(translation(stroke / 2 + (target[2] - stroke - width * sx) / 2,
    stroke / 2 + (target[3] - stroke - height * sy) / 2), multiply(scaling(sx, sy), translation(-x, -y)));
}
export function renderShape(node, layout, context, resources, options = {}) {
  const p = node.properties, type = node.type.split('.').at(-1), geometry = shapeGeometry(node, layout, options.resolve);
  const pen = shapePen(p);
  const simple = type === 'Rectangle' || type === 'Ellipse';
  if (!simple) context.PushTransform(shapeStretch(geometry, layout, p));
  if (p.GeometryTransform) context.PushTransform(transformValue(p.GeometryTransform, options.resolve));
  if (type === 'Rectangle') context.DrawRoundedRectangle(geometry.rect, geometry.radii, p.Fill, pen);
  else if (type === 'Ellipse') context.DrawEllipse(geometry.rect, p.Fill, pen);
  else context.DrawGeometry(geometry, type === 'Line' ? null : p.Fill, pen);
  if (p.GeometryTransform) context.Pop();
  if (!simple) context.Pop();
}

/** Natural shape measure includes the stroke's outer extents; stretch consumes available finite axes. */
export function measureShape(node, constraint, resolve) {
  const p = node.properties, width = Number.isFinite(p.Width) ? p.Width : 0, height = Number.isFinite(p.Height) ? p.Height : 0;
  const geometry = shapeGeometry(node, {width, height}, resolve), bounds = geometryBounds(geometry), stroke = p.Stroke ? p.StrokeThickness ?? 1 : 0;
  return {width: Number.isFinite(p.Width) ? p.Width : Math.max(0, bounds[0] + bounds[2] + stroke / 2),
    height: Number.isFinite(p.Height) ? p.Height : Math.max(0, bounds[1] + bounds[3] + stroke / 2)};
}
