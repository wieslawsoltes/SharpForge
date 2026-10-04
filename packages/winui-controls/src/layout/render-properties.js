import { finite, rect } from './geometry.js';

export const identityMatrix = Object.freeze([1, 0, 0, 1, 0, 0]);

export function multiplyMatrix(left, right) {
  return [left[0] * right[0] + left[2] * right[1], left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3], left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4], left[1] * right[4] + left[3] * right[5] + left[5]];
}

export function inverseMatrix(value) {
  const determinant = value[0] * value[3] - value[1] * value[2];
  if (Math.abs(determinant) < 1e-12) return null;
  return [value[3] / determinant, -value[1] / determinant, -value[2] / determinant, value[0] / determinant,
    (value[2] * value[5] - value[3] * value[4]) / determinant, (value[1] * value[4] - value[0] * value[5]) / determinant];
}

export function transformPoint(matrix, point) {
  return { x: matrix[0] * point.x + matrix[2] * point.y + matrix[4], y: matrix[1] * point.x + matrix[3] * point.y + matrix[5] };
}

export function transformBounds(matrix, bounds) {
  const points = [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y],
    [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]]
    .map(([x, y]) => transformPoint(matrix, { x, y }));
  const minimumX = Math.min(...points.map(point => point.x));
  const minimumY = Math.min(...points.map(point => point.y));
  return rect(minimumX, minimumY, Math.max(...points.map(point => point.x)) - minimumX,
    Math.max(...points.map(point => point.y)) - minimumY);
}

const translation = (x, y) => [1, 0, 0, 1, x, y];
const scale = (x, y) => [x, 0, 0, y, 0, 0];
const rotation = degrees => {
  const angle = degrees * Math.PI / 180;
  return [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
};

function transformMatrix(value, resolve, active = new Set()) {
  if (!value) return [...identityMatrix];
  value = value.$ref ? resolve(value.$ref) : value;
  if (!value) return [...identityMatrix];
  if (active.has(value) || active.size >= 128) throw new TypeError('RenderTransform cycle or depth limit');
  active.add(value);
  const transform = value.properties ?? value;
  const kind = (value.type ?? value.valueType ?? '').split('.').at(-1);
  let matrix = [...identityMatrix];
  if (kind === 'TransformGroup') {
    const children = value.collections?.Children ?? transform.Children ?? [];
    if (!Array.isArray(children) || children.length > 4096) throw new RangeError('TransformGroup child limit');
    for (const child of children) matrix = multiplyMatrix(transformMatrix(child, resolve, active), matrix);
  } else if (kind === 'MatrixTransform') {
    const raw = transform.Matrix;
    matrix = [raw?.M11 ?? 1, raw?.M12 ?? 0, raw?.M21 ?? 0, raw?.M22 ?? 1, raw?.OffsetX ?? 0, raw?.OffsetY ?? 0];
  } else {
    if (kind === 'ScaleTransform' || kind === 'CompositeTransform') matrix = scale(finite(transform.ScaleX, 1), finite(transform.ScaleY, 1));
    if (kind === 'SkewTransform' || kind === 'CompositeTransform') {
      matrix = multiplyMatrix([1, Math.tan(finite(transform.AngleY ?? transform.SkewY) * Math.PI / 180),
        Math.tan(finite(transform.AngleX ?? transform.SkewX) * Math.PI / 180), 1, 0, 0], matrix);
    }
    if (kind === 'RotateTransform' || kind === 'CompositeTransform') matrix = multiplyMatrix(rotation(finite(transform.Angle ?? transform.Rotation)), matrix);
    if (kind === 'TranslateTransform' || kind === 'CompositeTransform') matrix = multiplyMatrix(
      translation(finite(transform.X ?? transform.TranslateX), finite(transform.Y ?? transform.TranslateY)), matrix);
  }
  const centerX = finite(transform.CenterX);
  const centerY = finite(transform.CenterY);
  matrix = multiplyMatrix(translation(centerX, centerY), multiplyMatrix(matrix, translation(-centerX, -centerY)));
  active.delete(value);
  if (!matrix.every(Number.isFinite)) throw new TypeError('RenderTransform must be a finite affine matrix');
  return matrix;
}

/** Resolve either retained references or typed renderer descriptors, with one affine result for every backend. */
export function renderTransform(properties, dimensions, resolve = () => null, resolver = null) {
  let matrix = resolver ? resolver(properties.RenderTransform, resolve) : transformMatrix(properties.RenderTransform, resolve);
  if (!matrix || matrix.length !== 6 || ![...matrix].every(Number.isFinite)) throw new TypeError('Invalid render transform result');
  const origin = properties.RenderTransformOrigin ?? {};
  const originX = finite(origin.X ?? origin.x) * dimensions.width;
  const originY = finite(origin.Y ?? origin.y) * dimensions.height;
  matrix = multiplyMatrix(translation(originX, originY), multiplyMatrix(matrix, translation(-originX, -originY)));
  const center = properties.CenterPoint ?? {};
  const scaling = properties.Scale ?? {};
  const movement = properties.Translation ?? {};
  const facade = multiplyMatrix(translation(finite(center.X) + finite(movement.X), finite(center.Y) + finite(movement.Y)),
    multiplyMatrix(rotation(finite(properties.Rotation)), multiplyMatrix(scale(finite(scaling.X, 1), finite(scaling.Y, 1)),
      translation(-finite(center.X), -finite(center.Y)))));
  return multiplyMatrix(facade, matrix);
}

export function elementClip(properties, resolve = () => null) {
  const clip = properties.Clip?.$ref ? resolve(properties.Clip.$ref) : properties.Clip;
  const descriptor = clip?.properties ?? clip;
  const value = descriptor?.Rect ?? descriptor?.rect
    ?? (descriptor && (Object.hasOwn(descriptor, 'Width') || Object.hasOwn(descriptor, 'width')) ? descriptor : null);
  if (!value) return null;
  return rect(finite(value.X ?? value.x), finite(value.Y ?? value.y),
    Math.max(0, finite(value.Width ?? value.width)), Math.max(0, finite(value.Height ?? value.height)));
}
