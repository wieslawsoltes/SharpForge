import {finite, DrawingError, matrix as validateMatrix} from '../drawing/commands.js';

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
/** Affine matrices map column points; multiply(a,b) applies b, then a. */
export function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
export function transformPoint(transform, point) {
  const x = point[0] ?? point.x ?? point.X, y = point[1] ?? point.y ?? point.Y;
  return [transform[0] * x + transform[2] * y + transform[4], transform[1] * x + transform[3] * y + transform[5]];
}
export function inverse(transform) {
  const [a, b, c, d, x, y] = validateMatrix(transform), determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0) return null;
  return [d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * y - d * x) / determinant, (b * x - a * y) / determinant];
}
export function transformBounds(transform, rect) {
  const [x, y, width, height] = rect;
  const points = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map(point => transformPoint(transform, point));
  const left = Math.min(...points.map(point => point[0])), top = Math.min(...points.map(point => point[1]));
  return [left, top, Math.max(...points.map(point => point[0])) - left, Math.max(...points.map(point => point[1])) - top];
}
export function translation(x, y) { return [1, 0, 0, 1, finite(x), finite(y)]; }
export function scaling(x, y = x) { return [finite(x), 0, 0, finite(y), 0, 0]; }
export function rotation(degrees) {
  const radians = finite(degrees) * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  return [cosine, sine, -sine, cosine, 0, 0];
}
export function skew(x, y) { return [1, Math.tan(finite(y) * Math.PI / 180), Math.tan(finite(x) * Math.PI / 180), 1, 0, 0]; }
export function around(transform, x, y) { return multiply(translation(x, y), multiply(transform, translation(-x, -y))); }

/** Resolve the WinUI transform family without reading DOM layout or mutating framework objects. */
export function transformValue(value, resolve = item => item, depth = 0) {
  if (depth > 64) throw new DrawingError('SFRENDER020', 'Transform hierarchy is too deep or cyclic');
  if (!value) return IDENTITY;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return validateMatrix(value);
  const node = resolve(value) ?? value, props = node.properties ?? node;
  const kind = (node.type ?? node.valueType ?? node.kind ?? '').split('.').at(-1);
  if (kind === 'MatrixTransform' || kind === 'Matrix') {
    const matrix = props.Matrix ?? props;
    return validateMatrix(Array.isArray(matrix) ? matrix : [matrix.M11, matrix.M12, matrix.M21, matrix.M22, matrix.OffsetX, matrix.OffsetY]);
  }
  if (kind === 'TransformGroup') {
    const children = node.collections?.Children ?? props.Children ?? [];
    let result = IDENTITY;
    for (const child of children) result = multiply(transformValue(child, resolve, depth + 1), result);
    return result;
  }
  let result;
  if (kind === 'TranslateTransform') result = translation(props.X ?? 0, props.Y ?? 0);
  else if (kind === 'ScaleTransform') result = scaling(props.ScaleX ?? 1, props.ScaleY ?? 1);
  else if (kind === 'RotateTransform') result = rotation(props.Angle ?? 0);
  else if (kind === 'SkewTransform') result = skew(props.AngleX ?? 0, props.AngleY ?? 0);
  else if (kind === 'CompositeTransform') {
    result = multiply(translation(props.TranslateX ?? 0, props.TranslateY ?? 0), multiply(rotation(props.Rotation ?? 0),
      multiply(skew(props.SkewX ?? 0, props.SkewY ?? 0), scaling(props.ScaleX ?? 1, props.ScaleY ?? 1))));
  } else throw new DrawingError('SFRENDER021', `Unsupported transform ${kind}`);
  return around(result, props.CenterX ?? 0, props.CenterY ?? 0);
}

export function transformToVisual(sourceWorld, targetWorld = IDENTITY) {
  const targetInverse = inverse(targetWorld);
  if (!targetInverse) throw new DrawingError('SFRENDER022', 'Target visual transform is singular');
  return multiply(targetInverse, sourceWorld);
}

export class Matrix {
  constructor(m11 = 1, m12 = 0, m21 = 0, m22 = 1, offsetX = 0, offsetY = 0) {
    this.values = validateMatrix([m11, m12, m21, m22, offsetX, offsetY]);
  }
  get Inverse() { const value = inverse(this.values); return value && new Matrix(...value); }
  TransformPoint(point) { return transformPoint(this.values, point); }
  TransformBounds(rect) { return transformBounds(this.values, rect); }
}
