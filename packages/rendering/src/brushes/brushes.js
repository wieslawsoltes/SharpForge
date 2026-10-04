import {DrawingError, finite, resolveResource} from '../drawing/commands.js';
import {parseColor, cssColor, srgbToLinear, linearToSrgb} from '../media/colors.js';
import {IDENTITY, inverse, multiply, scaling, translation, transformPoint, transformValue} from '../media/transforms.js';

const point = (value, fallback) => value == null ? fallback :
  [finite(value[0] ?? value.X ?? value.x, 'brush coordinate'), finite(value[1] ?? value.Y ?? value.y, 'brush coordinate')];
const properties = value => value?.properties ?? value;

/** Normalize framework and composition brushes to backend-independent immutable descriptors. */
export function normalizeBrush(input, resources, resolve = value => value, depth = 0) {
  if (depth > 64) throw new DrawingError('SFRENDER052', 'Brush nesting budget exceeded');
  let value = resolveResource(resources, input, 'brush');
  if (value == null) return null;
  if (typeof value !== 'object' && typeof value !== 'string') throw new DrawingError('SFRENDER052', 'A brush must be typed data or a color');
  if (typeof value === 'string' || Array.isArray(value) || 'R' in value) return {kind: 'solid', color: parseColor(value), opacity: 1};
  value = resolve(value) ?? value;
  const p = properties(value), kind = p.kind ?? (value.type ?? value.valueType ?? 'SolidColorBrush').split('.').at(-1);
  const opacity = finite(p.opacity ?? p.Opacity ?? 1, 'brush opacity', 0, 1);
  const common = {opacity, transform: transformValue(p.transform ?? p.Transform, resolve),
    relativeTransform: transformValue(p.relativeTransform ?? p.RelativeTransform, resolve)};
  if (kind === 'RevealBrush') return {...common, kind: 'solid', color: parseColor(p.FallbackColor ?? '#cccccc'),
    policy: 'revealed-lighting-unavailable'};
  if (kind === 'solid' || kind === 'SolidColorBrush' || kind === 'CompositionColorBrush') {
    return {...common, kind: 'solid', color: parseColor(p.color ?? p.Color ?? '#00000000')};
  }
  if (['linear', 'radial', 'LinearGradientBrush', 'RadialGradientBrush', 'CompositionLinearGradientBrush', 'CompositionRadialGradientBrush'].includes(kind)) {
    const source = p.stops ?? value.collections?.GradientStops ?? value.collections?.ColorStops ?? p.GradientStops ?? p.ColorStops ?? [];
    if (!Array.isArray(source) || source.length > 4096) throw new DrawingError('SFRENDER051', 'Gradient stop count exceeds budget');
    const stops = source.map(item => {
      const stop = properties(resolve(item) ?? item);
      return {offset: finite(stop.offset ?? stop.Offset, 'gradient stop', -1e6, 1e6), color: parseColor(stop.color ?? stop.Color)};
    }).sort((a, b) => a.offset - b.offset);
    const spread = p.spread ?? ['pad', 'reflect', 'repeat'][p.SpreadMethod ?? 0];
    if (!['pad', 'reflect', 'repeat'].includes(spread)) throw new DrawingError('SFRENDER051', 'Unsupported gradient spread');
    const mapping = p.mapping ?? ['relative', 'absolute'][p.MappingMode ?? 0];
    const interpolation = p.interpolation ?? ['linear', 'srgb'][p.ColorInterpolationMode ?? 1];
    if (!['relative', 'absolute'].includes(mapping) || !['srgb', 'linear'].includes(interpolation)) {
      throw new DrawingError('SFRENDER051', 'Unsupported gradient mapping or interpolation mode');
    }
    const radius = Array.from(p.radius ?? [p.RadiusX ?? 0.5, p.RadiusY ?? 0.5], value => finite(value, 'gradient radius', 0, 1000000));
    if (radius.length !== 2) throw new DrawingError('SFRENDER051', 'A radial gradient needs two radii');
    return {...common, kind: kind.toLowerCase().includes('radial') ? 'radial' : 'linear', stops, spread,
      mapping, interpolation, start: point(p.start ?? p.StartPoint, [0, 0]),
      end: point(p.end ?? p.EndPoint, [1, 1]), center: point(p.center ?? p.Center, [0.5, 0.5]),
      origin: point(p.origin ?? p.GradientOrigin, point(p.center ?? p.Center, [0.5, 0.5])),
      radius};
  }
  if (kind === 'image' || kind === 'ImageBrush' || kind === 'CompositionSurfaceBrush') {
    return {...common, kind: 'image', image: p.image ?? p.ImageSource ?? p.Surface,
      stretch: p.stretch ?? p.Stretch ?? 2, alignmentX: p.alignmentX ?? p.AlignmentX ?? 1,
      alignmentY: p.alignmentY ?? p.AlignmentY ?? 1, sampling: p.sampling ?? 'linear'};
  }
  if (kind === 'acrylic' || kind === 'AcrylicBrush') {
    return {...common, kind: 'acrylic', tint: parseColor(p.tint ?? p.TintColor ?? '#ffffff'),
      tintOpacity: finite(p.tintOpacity ?? p.TintOpacity ?? 0.5, 'tint opacity', 0, 1),
      luminosityOpacity: finite(p.luminosityOpacity ?? p.TintLuminosityOpacity ?? 0, 'luminosity opacity', 0, 1),
      fallback: parseColor(p.fallback ?? p.FallbackColor ?? '#cccccc'), blur: finite(p.blur ?? 30, 'blur radius', 0, 256),
      noiseOpacity: finite(p.noiseOpacity ?? 0.02, 'noise opacity', 0, 1), alwaysUseFallback: Boolean(p.AlwaysUseFallback ?? p.alwaysUseFallback)};
  }
  if (kind === 'mask') return {...common, kind, source: p.source, mask: p.mask};
  if (kind === 'nine-grid') {
    const insets = p.insets ?? [0, 0, 0, 0];
    if (!Array.isArray(insets) || insets.length !== 4) throw new DrawingError('SFRENDER052', 'Nine-grid brushes require four insets');
    return {...common, kind, source: p.source, insets: insets.map(value => finite(value, 'nine-grid inset', 0))};
  }
  if (kind === 'backdrop') return {...common, kind, fallback: parseColor(p.fallback ?? '#00000000')};
  if (kind === 'effect') return {...common, kind, graph: p.graph, sources: p.sources ?? {}};
  if (kind === 'XamlCompositionBrushBase') {
    const composition = p.CompositionBrush ? normalizeBrush(p.CompositionBrush, resources, resolve, depth + 1) :
      {kind: 'solid', color: [0, 0, 0, 0], opacity: 1};
    return {...composition, opacity: composition.opacity * opacity};
  }
  throw new DrawingError('SFRENDER052', `Unsupported brush ${kind}`);
}

export function brushMatrix(brush, bounds) {
  const [x, y, width, height] = bounds;
  const relative = multiply(translation(x, y), multiply(scaling(width || 1, height || 1),
    multiply(brush.relativeTransform ?? IDENTITY, multiply(scaling(1 / (width || 1), 1 / (height || 1)), translation(-x, -y)))));
  return multiply(brush.transform ?? IDENTITY, relative);
}
export function spreadValue(value, spread) {
  if (spread === 'repeat') return ((value % 1) + 1) % 1;
  if (spread === 'reflect') { const phase = ((value % 2) + 2) % 2; return phase > 1 ? 2 - phase : phase; }
  return Math.max(0, Math.min(1, value));
}
export function gradientColor(brush, position) {
  const stops = brush.stops;
  if (!stops.length) return [0, 0, 0, 0];
  const value = spreadValue(position, brush.spread);
  if (value <= stops[0].offset) return [...stops[0].color];
  let low = 0, high = stops.length;
  while (low < high) { const middle = (low + high) >>> 1; if (stops[middle].offset <= value) low = middle + 1; else high = middle; }
  if (low === stops.length) return [...stops.at(-1).color];
  const left = stops[low - 1], right = stops[low], fraction = (value - left.offset) / (right.offset - left.offset);
  const color = left.color.map((channel, index) => {
    if (index === 3 || brush.interpolation !== 'linear') return channel + (right.color[index] - channel) * fraction;
    return linearToSrgb(srgbToLinear(channel) + (srgbToLinear(right.color[index]) - srgbToLinear(channel)) * fraction);
  });
  return color;
}
export function sampleBrush(brush, x, y, bounds) {
  if (!brush) return [0, 0, 0, 0];
  if (brush.kind === 'solid') { const color = [...brush.color]; color[3] *= brush.opacity; return color; }
  const inverseTransform = inverse(brushMatrix(brush, bounds));
  if (!inverseTransform) return [0, 0, 0, 0];
  [x, y] = transformPoint(inverseTransform, [x, y]);
  if (brush.mapping !== 'absolute') { x = (x - bounds[0]) / (bounds[2] || 1); y = (y - bounds[1]) / (bounds[3] || 1); }
  let position;
  if (brush.kind === 'linear') {
    const dx = brush.end[0] - brush.start[0], dy = brush.end[1] - brush.start[1], denominator = dx * dx + dy * dy;
    position = denominator ? ((x - brush.start[0]) * dx + (y - brush.start[1]) * dy) / denominator : 1;
  } else if (brush.kind === 'radial') {
    const [rx, ry] = brush.radius;
    if (!rx || !ry) position = 1;
    else {
      const ox = (brush.origin[0] - brush.center[0]) / rx, oy = (brush.origin[1] - brush.center[1]) / ry;
      const dx = (x - brush.origin[0]) / rx, dy = (y - brush.origin[1]) / ry;
      const a = dx * dx + dy * dy, b = 2 * (ox * dx + oy * dy), c = ox * ox + oy * oy - 1;
      const hit = a ? (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a) : Infinity;
      position = hit > 0 ? 1 / hit : 1;
    }
  } else if (brush.kind === 'acrylic') return [...brush.fallback];
  else throw new DrawingError('SFRENDER053', `Brush ${brush.kind} requires an image sampler`);
  const color = gradientColor(brush, position); color[3] *= brush.opacity; return color;
}

export function solidCss(brush) { const color = [...brush.color]; color[3] *= brush.opacity; return cssColor(color); }

/** Resource invalidation is explicit; subscription lifetime follows the brush's live consumers. */
export class ObservableBrush {
  constructor(value) { this.value = value; this.version = 0; this.listeners = new Set(); }
  update(value) { this.value = value; this.version++; for (const listener of this.listeners) listener(this); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose() { this.listeners.clear(); }
}
