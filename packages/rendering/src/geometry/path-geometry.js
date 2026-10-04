import {finite, rectangle, radii as normalizeRadii, matrix as validateMatrix, DrawingError} from '../drawing/commands.js';
import {parsePath, pathToSvg} from './path-markup.js';
import {IDENTITY, multiply, transformValue} from '../media/transforms.js';

export const pointValue = value => [finite(value?.[0] ?? value?.x ?? value?.X), finite(value?.[1] ?? value?.y ?? value?.Y)];

/** Geometry data is independent of the UI tree and serializes without a browser or GPU. */
export class PathGeometry {
  constructor(figures = [], fillRule = 'evenodd') {
    this.kind = 'path';
    this.figures = figures;
    this.fillRule = fillRule;
    this.transform = IDENTITY;
  }
  static parse(source, options) { const parsed = parsePath(source, options); return new PathGeometry(parsed.figures, parsed.fillRule); }
  toString() { return pathToSvg(this); }
}
export class PathFigure {
  constructor(start = [0, 0], segments = [], closed = false, filled = true) {
    this.start = pointValue(start); this.segments = segments; this.closed = !!closed; this.filled = !!filled;
  }
}
export class LineSegment { constructor(end) { this.kind = 'line'; this.end = pointValue(end); } }
export class BezierSegment {
  constructor(control1, control2, end) {
    this.kind = 'cubic'; this.control1 = pointValue(control1); this.control2 = pointValue(control2); this.end = pointValue(end);
  }
}
export class QuadraticBezierSegment {
  constructor(control, end) { this.kind = 'quadratic'; this.control = pointValue(control); this.end = pointValue(end); }
}
export class ArcSegment {
  constructor(end, radius, options = {}) {
    this.kind = 'arc'; this.end = pointValue(end); this.radius = pointValue(radius);
    this.rotation = finite(options.rotation ?? 0); this.large = !!options.large; this.clockwise = options.clockwise !== false;
  }
}
export class RectangleGeometry {
  constructor(rect, radius = 0) { this.kind = 'rectangle'; this.rect = rectangle(rect); this.radii = normalizeRadii(radius, this.rect); }
}
export class EllipseGeometry {
  constructor(center, radiusX, radiusY) {
    const [x, y] = pointValue(center); this.kind = 'ellipse';
    this.rect = [x - finite(radiusX, 'radiusX', 0), y - finite(radiusY, 'radiusY', 0), radiusX * 2, radiusY * 2];
  }
}
export class LineGeometry {
  constructor(start, end) { this.kind = 'path'; this.figures = [new PathFigure(start, [new LineSegment(end)], false, false)]; }
}
export class GeometryGroup {
  constructor(children = [], fillRule = 'evenodd') { this.kind = 'group'; this.children = children; this.fillRule = fillRule; }
}

function normalizeSegment(node, resolve) {
  const value = resolve(node) ?? node, p = value.properties ?? value, kind = (value.type ?? value.kind ?? '').split('.').at(-1);
  if (p.kind) { validateNativeSegment(p); return p; }
  if (kind === 'LineSegment') return new LineSegment(p.Point);
  if (kind === 'BezierSegment') return new BezierSegment(p.Point1, p.Point2, p.Point3);
  if (kind === 'QuadraticBezierSegment') return new QuadraticBezierSegment(p.Point1, p.Point2);
  if (kind === 'ArcSegment') return new ArcSegment(p.Point, [p.Size?.Width ?? 0, p.Size?.Height ?? 0],
    {rotation: p.RotationAngle, large: p.IsLargeArc, clockwise: p.SweepDirection === 1});
  const points = value.collections?.Points ?? p.Points;
  if (kind === 'PolyLineSegment') return (points ?? []).map(point => new LineSegment(resolve(point) ?? point));
  if (kind === 'PolyBezierSegment') {
    if (points.length % 3) throw new DrawingError('SFRENDER039', 'PolyBezierSegment needs groups of three points');
    const segments = [];
    for (let index = 0; index < points.length; index += 3) segments.push(new BezierSegment(...points.slice(index, index + 3)));
    return segments;
  }
  if (kind === 'PolyQuadraticBezierSegment') {
    if (points.length % 2) throw new DrawingError('SFRENDER039', 'PolyQuadraticBezierSegment needs pairs of points');
    const segments = [];
    for (let index = 0; index < points.length; index += 2) segments.push(new QuadraticBezierSegment(...points.slice(index, index + 2)));
    return segments;
  }
  throw new DrawingError('SFRENDER039', `Unsupported geometry segment ${kind}`);
}

function validateNativeSegment(segment) {
  pointValue(segment.end);
  if (segment.kind === 'cubic') { pointValue(segment.control1); pointValue(segment.control2); }
  else if (segment.kind === 'quadratic') pointValue(segment.control);
  else if (segment.kind === 'arc') {
    const radius = pointValue(segment.radius);
    for (const value of radius) finite(value, 'arc radius', 0);
    finite(segment.rotation ?? 0, 'arc rotation');
  } else if (segment.kind !== 'line') throw new DrawingError('SFRENDER039', 'Unknown native geometry segment');
}

function validateNativeGeometry(value, resolve, depth) {
  if (value.transform) validateMatrix(value.transform);
  if (value.kind === 'rectangle' || value.kind === 'ellipse') {
    rectangle(value.rect);
    if (value.kind === 'rectangle') normalizeRadii(value.radii ?? 0, value.rect);
  } else if (value.kind === 'group') {
    if (!Array.isArray(value.children) || value.children.length > 100000) throw new DrawingError('SFRENDER040', 'Geometry group budget exceeded');
    for (const child of value.children) normalizeGeometry(child, resolve, depth + 1);
  } else if (value.kind === 'path') {
    if (!Array.isArray(value.figures) || value.figures.length > 100000) throw new DrawingError('SFRENDER040', 'Path figure budget exceeded');
    let count = 0;
    for (const figure of value.figures) {
      pointValue(figure.start);
      if (figure.transform) validateMatrix(figure.transform);
      if (!Array.isArray(figure.segments) || (count += figure.segments.length) > 1000000) {
        throw new DrawingError('SFRENDER040', 'Path segment budget exceeded');
      }
      for (const segment of figure.segments) validateNativeSegment(segment);
    }
  } else throw new DrawingError('SFRENDER040', `Unknown geometry kind ${value.kind}`);
  if (value.fillRule != null && !['evenodd', 'nonzero'].includes(value.fillRule)) throw new DrawingError('SFRENDER041', 'Unknown fill rule');
}

/** Accept native geometry data or managed scene nodes through an explicit reference resolver. */
export function normalizeGeometry(input, resolve = value => value, depth = 0) {
  if (depth > 64) throw new DrawingError('SFRENDER040', 'Geometry nesting budget exceeded');
  if (typeof input === 'string') return parsePath(input);
  if (!input) return {kind: 'path', figures: [], fillRule: 'evenodd'};
  const node = resolve(input) ?? input, p = node.properties ?? node;
  if (p.kind) { validateNativeGeometry(p, resolve, depth); return p; }
  const kind = (node.type ?? node.valueType ?? '').split('.').at(-1);
  let result;
  if (kind === 'PathGeometry') {
    const figures = node.collections?.Figures ?? p.Figures ?? [];
    result = new PathGeometry(figures.map(item => {
      const figure = resolve(item) ?? item, properties = figure.properties ?? figure;
      return new PathFigure(properties.StartPoint ?? [0, 0],
        (figure.collections?.Segments ?? properties.Segments ?? []).flatMap(segment => normalizeSegment(segment, resolve)),
        properties.IsClosed, properties.IsFilled !== false);
    }), p.FillRule === 1 ? 'nonzero' : 'evenodd');
  } else if (kind === 'RectangleGeometry') result = new RectangleGeometry(p.Rect, [p.RadiusX ?? 0, p.RadiusY ?? 0]);
  else if (kind === 'EllipseGeometry') result = new EllipseGeometry(p.Center, p.RadiusX ?? 0, p.RadiusY ?? 0);
  else if (kind === 'LineGeometry') result = new LineGeometry(p.StartPoint, p.EndPoint);
  else if (kind === 'GeometryGroup') result = new GeometryGroup(
    (node.collections?.Children ?? p.Children ?? []).map(child => normalizeGeometry(child, resolve, depth + 1)),
    p.FillRule === 1 ? 'nonzero' : 'evenodd');
  else throw new DrawingError('SFRENDER040', `Unsupported geometry ${kind}`);
  if (p.Transform) result.transform = transformValue(p.Transform, resolve);
  return result;
}

/** Convert simple primitives to exact arc/line path data shared by SVG, Canvas and tessellation. */
export function geometryToPath(input) {
  const geometry = normalizeGeometry(input);
  if (geometry.kind === 'path') return geometry;
  if (geometry.kind === 'group') {
    const figures = [];
    for (const child of geometry.children) {
      const path = geometryToPath(child);
      for (const figure of path.figures) figures.push({...figure,
        transform: multiply(geometry.transform ?? IDENTITY, multiply(path.transform ?? IDENTITY, figure.transform ?? IDENTITY))});
    }
    return {kind: 'path', fillRule: geometry.fillRule, figures};
  }
  const [x, y, width, height] = geometry.rect;
  if (geometry.kind === 'ellipse') {
    return {kind: 'path', fillRule: 'nonzero', transform: geometry.transform, figures: [{start: [x + width, y + height / 2],
      closed: true, filled: true, segments: [
        {kind: 'arc', radius: [width / 2, height / 2], rotation: 0, large: false, clockwise: true, end: [x, y + height / 2]},
        {kind: 'arc', radius: [width / 2, height / 2], rotation: 0, large: false, clockwise: true, end: [x + width, y + height / 2]}
      ]}]};
  }
  if (geometry.kind !== 'rectangle') throw new DrawingError('SFRENDER040', `Unsupported geometry kind ${geometry.kind}`);
  const r = normalizeRadii(geometry.radii ?? 0, geometry.rect);
  const segments = [], end = (px, py) => [px, py];
  const line = point => segments.push({kind: 'line', end: point});
  const arc = (radiusX, radiusY, point) => segments.push({kind: 'arc', radius: [radiusX, radiusY],
    rotation: 0, clockwise: true, large: false, end: point});
  line(end(x + width - r[2], y)); arc(r[2], r[3], end(x + width, y + r[3]));
  line(end(x + width, y + height - r[5])); arc(r[4], r[5], end(x + width - r[4], y + height));
  line(end(x + r[6], y + height)); arc(r[6], r[7], end(x, y + height - r[7]));
  line(end(x, y + r[1])); arc(r[0], r[1], end(x + r[0], y));
  return {kind: 'path', fillRule: 'nonzero', transform: geometry.transform,
    figures: [{start: [x + r[0], y], segments, closed: true, filled: true}]};
}
