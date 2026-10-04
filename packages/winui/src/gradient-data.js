const media = 'Microsoft.UI.Xaml.Media.';
export const linearGradientType = media + 'LinearGradientBrush';
export const gradientStopType = media + 'GradientStop';
export const gradientCollectionType = media + 'GradientStopCollection';
export const pointType = 'Windows.Foundation.Point';

export function gradientFailure(message) {
  const error = new TypeError('SFUI_GRADIENT: ' + message);
  error.code = 'SFUI_GRADIENT';
  return error;
}

function fields(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw gradientFailure(label + ' requires a record.');
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw gradientFailure(label + ' does not support ' + key + '.');
  }
}

export function gradientNumber(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw gradientFailure(label + ' is outside the portable finite range [' + min + ', ' + max + '].');
  }
  return value;
}

export function gradientPoint(value, fallback) {
  if (value === undefined) value = fallback;
  fields(value, ['valueType', 'X', 'Y'], 'Point');
  if (value.valueType !== undefined && value.valueType !== pointType) throw gradientFailure('Point type mismatch.');
  return {X: gradientNumber(value.X, -100000, 100000, 'Point.X'), Y: gradientNumber(value.Y, -100000, 100000, 'Point.Y')};
}

export function gradientColor(value) {
  fields(value, ['valueType', 'A', 'R', 'G', 'B'], 'Color');
  if (value.valueType !== 'Windows.UI.Color') throw gradientFailure('Windows.UI.Color is required.');
  const result = {valueType: value.valueType};
  for (const key of ['A', 'R', 'G', 'B']) {
    result[key] = gradientNumber(value[key], 0, 255, 'Color.' + key);
    if (!Number.isInteger(result[key])) throw gradientFailure('Color channels must be bytes.');
  }
  return result;
}

/** Validate the closed portable brush record; unsupported modes and extra fields are errors, never ignored. */
export function normalizeLinearGradientBrush(value) {
  fields(value, ['valueType', 'StartPoint', 'EndPoint', 'Opacity', 'GradientStops'], 'LinearGradientBrush');
  if (value.valueType !== linearGradientType) throw gradientFailure('LinearGradientBrush type mismatch.');
  const stops = value.GradientStops === undefined ? [] : value.GradientStops;
  if (!Array.isArray(stops) || stops.length > 10000) throw gradientFailure('GradientStops requires at most 10000 stops.');
  return {
    valueType: linearGradientType,
    StartPoint: gradientPoint(value.StartPoint, {X: 0, Y: 0}),
    EndPoint: gradientPoint(value.EndPoint, {X: 1, Y: 1}),
    Opacity: gradientNumber(value.Opacity === undefined ? 1 : value.Opacity, 0, 1, 'Opacity'),
    GradientStops: Array.from(stops, stop => {
      fields(stop, ['valueType', 'Color', 'Offset'], 'GradientStop');
      if (stop.valueType !== undefined && stop.valueType !== gradientStopType) throw gradientFailure('GradientStop type mismatch.');
      return {Color: gradientColor(stop.Color), Offset: gradientNumber(stop.Offset === undefined ? 0 : stop.Offset, 0, 1, 'Offset')};
    }).sort((left, right) => left.Offset - right.Offset)
  };
}

export const isLinearGradient = value => value?.valueType === linearGradientType;
