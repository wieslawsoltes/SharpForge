import {DrawingModel, DrawingCollection} from './models.js';
import {parseColor} from './colors.js';
import {normalizeBrush} from '../brushes/brushes.js';
import {parsePath} from '../geometry/path-markup.js';
import {DrawingError, finite} from '../drawing/commands.js';

const M = 'Microsoft.UI.Xaml.Media.', F = 'Windows.Foundation.';
const colorValue = value => { const [r, g, b, a] = parseColor(value);
  return {A: Math.round(a * 255), R: Math.round(r * 255), G: Math.round(g * 255), B: Math.round(b * 255)}; };
const pointValue = value => new DrawingModel(F + 'Point', {X: value[0] ?? value.X, Y: value[1] ?? value.Y});
const collection = (type, values) => new DrawingCollection(M + type, values);

function brushModel(value) {
  const brush = normalizeBrush(value), common = {Opacity: brush.opacity};
  if (brush.transform) common.Transform = matrixModel(brush.transform);
  if (brush.relativeTransform) common.RelativeTransform = matrixModel(brush.relativeTransform);
  if (brush.kind === 'solid') return new DrawingModel(M + 'SolidColorBrush', {...common, Color: colorValue(brush.color)});
  if (brush.kind === 'linear' || brush.kind === 'radial') {
    const data = {...common, GradientStops: collection('GradientStopCollection', brush.stops.map(stop =>
      new DrawingModel(M + 'GradientStop', {Offset: stop.offset, Color: colorValue(stop.color)}))),
    MappingMode: brush.mapping === 'absolute' ? 1 : 0, SpreadMethod: ['pad', 'reflect', 'repeat'].indexOf(brush.spread),
    ColorInterpolationMode: brush.interpolation === 'linear' ? 0 : 1};
    if (brush.kind === 'linear') Object.assign(data, {StartPoint: pointValue(brush.start), EndPoint: pointValue(brush.end)});
    else Object.assign(data, {Center: pointValue(brush.center), GradientOrigin: pointValue(brush.origin),
      RadiusX: brush.radius[0], RadiusY: brush.radius[1]});
    return new DrawingModel(M + (brush.kind === 'linear' ? 'LinearGradientBrush' : 'RadialGradientBrush'), data);
  }
  if (brush.kind === 'image') return new DrawingModel(M + 'ImageBrush', {...common, ImageSource: brush.image,
    Stretch: brush.stretch, AlignmentX: brush.alignmentX, AlignmentY: brush.alignmentY});
  if (brush.kind === 'acrylic') return new DrawingModel(M + 'AcrylicBrush', {...common, TintColor: colorValue(brush.tint),
    TintOpacity: brush.tintOpacity, TintLuminosityOpacity: brush.luminosityOpacity, FallbackColor: colorValue(brush.fallback)});
  return new DrawingModel(M + 'XamlCompositionBrushBase', {...common, CompositionBrush: value});
}
function matrixModel(values) {
  const fields = ['M11', 'M12', 'M21', 'M22', 'OffsetX', 'OffsetY'];
  const matrix = new DrawingModel(M + 'Matrix', Object.fromEntries(fields.map((field, index) => [field, values[index]])));
  return new DrawingModel(M + 'MatrixTransform', {Matrix: matrix});
}
function segmentModel(segment) {
  if (segment.kind === 'line') return new DrawingModel(M + 'LineSegment', {Point: pointValue(segment.end)});
  if (segment.kind === 'quadratic') return new DrawingModel(M + 'QuadraticBezierSegment',
    {Point1: pointValue(segment.control), Point2: pointValue(segment.end)});
  if (segment.kind === 'cubic') return new DrawingModel(M + 'BezierSegment',
    {Point1: pointValue(segment.control1), Point2: pointValue(segment.control2), Point3: pointValue(segment.end)});
  return new DrawingModel(M + 'ArcSegment', {Point: pointValue(segment.end),
    Size: new DrawingModel(F + 'Size', {Width: segment.radius[0], Height: segment.radius[1]}), RotationAngle: segment.rotation,
    IsLargeArc: segment.large, SweepDirection: segment.clockwise ? 1 : 0});
}
function pathModel(value) {
  const path = typeof value === 'string' ? parsePath(value) : value;
  return new DrawingModel(M + 'PathGeometry', {FillRule: path.fillRule === 'nonzero' ? 1 : 0,
    Figures: collection('PathFigureCollection', path.figures.map(figure => new DrawingModel(M + 'PathFigure', {
      StartPoint: pointValue(figure.start), IsClosed: figure.closed, IsFilled: figure.filled !== false,
      Segments: collection('PathSegmentCollection', figure.segments.map(segmentModel))
    })))});
}

/** Materialize immutable resource descriptors using exact declared property types and cache native models, never VM refs. */
export function materializeRenderingResource(context, value, propertyType = 'object') {
  if (value == null) return context.managed(value, propertyType);
  if (value?.renderType) return context.wrapModel(value, value.renderType);
  if (propertyType === 'Windows.UI.Color') return context.allocate(propertyType, colorValue(value));
  const fields = {[F + 'Point']: ['X', 'Y'], [F + 'Size']: ['Width', 'Height'], [F + 'Rect']: ['X', 'Y', 'Width', 'Height'],
    ['Microsoft.UI.Xaml.Thickness']: ['Left', 'Top', 'Right', 'Bottom'],
    ['Microsoft.UI.Xaml.CornerRadius']: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft']};
  if (fields[propertyType]) {
    let values = typeof value === 'number' ? [value] : typeof value === 'string' ? value.trim().split(/[\s,]+/).map(Number) : value;
    if (Array.isArray(values) && fields[propertyType].length === 4) {
      if (values.length === 1) values = Array(4).fill(values[0]);
      else if (values.length === 2 && propertyType.endsWith('Thickness')) values = [values[0], values[1], values[0], values[1]];
    }
    const data = Object.fromEntries(fields[propertyType].map((field, index) => [field,
      finite(values[field] ?? values[index], field)]));
    return propertyType.startsWith(F) ? context.wrapModel(new DrawingModel(propertyType, data), propertyType) : context.allocate(propertyType, data);
  }
  const cache = context.renderingResourceCache ??= new Map();
  const cacheKey = typeof value === 'object' ? value : `${propertyType}:${String(value)}`;
  let model = cache.get(cacheKey);
  if (!model) {
    const kind = value.kind ?? value.type?.split('.').at(-1) ?? value.valueType?.split('.').at(-1);
    if (propertyType.endsWith('Brush') || kind?.endsWith('Brush')) model = brushModel(value);
    else if (propertyType === M + 'Geometry' || propertyType === M + 'PathGeometry') model = pathModel(value);
    else if ((propertyType === M + 'Transform' || propertyType === M + 'MatrixTransform') && Array.isArray(value)) model = matrixModel(value);
    else if (propertyType === M + 'FontFamily' && typeof value === 'string') return context.allocate(propertyType, {Source: value});
    else if (value && typeof value === 'object' && (value.valueType || value.type)) {
      model = new DrawingModel(value.valueType ?? value.type, {...(value.properties ?? value)});
    } else return context.managed(value, propertyType);
    if (!model?.renderType) throw new DrawingError('SFRENDER132', `Cannot materialize rendering resource ${propertyType}`);
    if (cache.size >= 4096) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, model);
  }
  return context.wrapModel(model, model.renderType);
}
