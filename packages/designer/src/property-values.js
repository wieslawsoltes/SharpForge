import {MEDIA, XAML, frameworkType} from '@sharpforge/framework';
import {authoringError, boundedArray, finiteNumber} from './property-diagnostics.js';

const colorType = 'Windows.UI.Color';
const brushTypes = new Set([MEDIA + 'Brush', MEDIA + 'SolidColorBrush', MEDIA + 'LinearGradientBrush']);

/** Parse exact WinUI #AARRGGBB / #RRGGBB colors or bounded RGBA components. */
export function normalizeDesignerColor(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text)) {
      authoringError('SFD1810', 'Colors use #RRGGBB or #AARRGGBB.');
    }
    const hex = text.length === 7 ? 'ff' + text.slice(1) : text.slice(1);
    return {valueType: colorType, A: parseInt(hex.slice(0, 2), 16), R: parseInt(hex.slice(2, 4), 16),
      G: parseInt(hex.slice(4, 6), 16), B: parseInt(hex.slice(6, 8), 16)};
  }
  if (!value || typeof value !== 'object') authoringError('SFD1810', 'A color requires four RGBA channels.');
  const result = {valueType: colorType};
  for (const channel of ['A', 'R', 'G', 'B']) {
    result[channel] = finiteNumber(value[channel], {label: channel, minimum: 0, maximum: 255, integer: true});
  }
  return result;
}

export function designerColorHex(value, {alpha = true} = {}) {
  const color = normalizeDesignerColor(value);
  return '#' + (alpha ? ['A', 'R', 'G', 'B'] : ['R', 'G', 'B']).map(key => color[key].toString(16).padStart(2, '0')).join('');
}

export function colorToHsv(value) {
  const color = normalizeDesignerColor(value);
  const red = color.R / 255;
  const green = color.G / 255;
  const blue = color.B / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const sector = delta === 0 ? 0 : maximum === red ? (green - blue) / delta :
    maximum === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return {h: ((sector * 60) % 360 + 360) % 360, s: maximum === 0 ? 0 : delta / maximum,
    v: maximum, a: color.A / 255};
}

export function hsvToColor({h, s, v, a = 1}) {
  h = finiteNumber(h, {label: 'Hue', minimum: 0, maximum: 360}) % 360;
  s = finiteNumber(s, {label: 'Saturation', minimum: 0, maximum: 1});
  v = finiteNumber(v, {label: 'Brightness', minimum: 0, maximum: 1});
  a = finiteNumber(a, {label: 'Alpha', minimum: 0, maximum: 1});
  const chroma = v * s;
  const secondary = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  const components = [[chroma, secondary, 0], [secondary, chroma, 0], [0, chroma, secondary],
    [0, secondary, chroma], [secondary, 0, chroma], [chroma, 0, secondary]][Math.floor(h / 60)];
  return {valueType: colorType, A: Math.round(a * 255), R: Math.round((components[0] + v - chroma) * 255),
    G: Math.round((components[1] + v - chroma) * 255), B: Math.round((components[2] + v - chroma) * 255)};
}

function point(value, fallback) {
  value ??= fallback;
  return {X: finiteNumber(value.X, {label: 'Point X', minimum: -100000, maximum: 100000}),
    Y: finiteNumber(value.Y, {label: 'Point Y', minimum: -100000, maximum: 100000})};
}

/** Gradient ordering is stable: equal offsets retain author order. Maximum 64 stops. */
export function normalizeDesignerBrush(value) {
  if (typeof value === 'string') return {valueType: MEDIA + 'SolidColorBrush', Color: normalizeDesignerColor(value)};
  if (!value || typeof value !== 'object') authoringError('SFD1811', 'Choose a solid color, gradient or resource.');
  if (value.valueType === MEDIA + 'LinearGradientBrush') {
    const stops = boundedArray(value.GradientStops, 64, 'Gradient stops');
    if (stops.length < 2) authoringError('SFD1811', 'A gradient requires at least two stops.');
    const normalized = stops.map(stop => ({Color: normalizeDesignerColor(stop.Color),
      Offset: finiteNumber(stop.Offset, {label: 'Stop offset', minimum: 0, maximum: 1})}));
    normalized.sort((left, right) => left.Offset - right.Offset);
    return {valueType: MEDIA + 'LinearGradientBrush', StartPoint: point(value.StartPoint, {X: 0, Y: 0}),
      EndPoint: point(value.EndPoint, {X: 1, Y: 1}), GradientStops: normalized,
      Opacity: finiteNumber(value.Opacity ?? 1, {label: 'Brush opacity', minimum: 0, maximum: 1})};
  }
  if (value.Color) {
    const result = {valueType: MEDIA + 'SolidColorBrush', Color: normalizeDesignerColor(value.Color)};
    if (value.Opacity !== undefined) result.Opacity = finiteNumber(value.Opacity, {minimum: 0, maximum: 1, label: 'Brush opacity'});
    return result;
  }
  authoringError('SFD1811', 'Unsupported brush type.');
}

export function compoundFields(type) {
  if (type === XAML + 'Thickness') return ['Left', 'Top', 'Right', 'Bottom'];
  if (type === XAML + 'CornerRadius') return ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'];
  return null;
}

/** Used as the first normalization seam; undefined means the existing normalizer owns this value. */
export function normalizeExtendedDesignerProperty(type, name, value, schema) {
  const property = schema[name];
  if (!property || property.readOnly || property.isStatic || value === null) return undefined;
  if (brushTypes.has(property.type)) return normalizeDesignerBrush(value);
  const enumeration = frameworkType(property.type);
  if (enumeration?.kind === 'enum' && (enumeration.flags || property.flags)) {
    const allowed = Object.values(enumeration.values).reduce((bits, flag) => bits | flag, 0) >>> 0;
    const number = finiteNumber(value, {label: name, minimum: 0, maximum: 4294967295, integer: true});
    if (((number >>> 0) & ~allowed) !== 0) authoringError('SFD1812', `${name} contains unsupported flags.`);
    return number;
  }
  return undefined;
}

export function scrubDesignerNumber(value, pixels, constraints = {}, {step = 1, fine = false, coarse = false} = {}) {
  const start = finiteNumber(value, {label: 'Starting value'});
  const delta = finiteNumber(pixels, {label: 'Scrub distance'}) * step * (fine ? 0.1 : coarse ? 10 : 1);
  const result = Math.min(constraints.maximum ?? Number.MAX_VALUE, Math.max(constraints.minimum ?? -Number.MAX_VALUE, start + delta));
  return constraints.integer ? Math.round(result) : Math.round(result * 1000000) / 1000000;
}
