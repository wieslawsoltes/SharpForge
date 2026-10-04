/** Designer geometry errors expose stable diagnostic codes without mutating a document. */
export class DesignGeometryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DesignGeometryError';
    this.code = code;
    this.diagnostic = {code, severity: 'error', message, span: {start: 0, length: 0}};
  }
}

export function geometryInvariant(condition, code, message) {
  if (!condition) throw new DesignGeometryError(code, message);
}

/** CSS/WinUI affine matrix [a,b,c,d,e,f], measured in design pixels. */
export const identityMatrix = () => [1, 0, 0, 1, 0, 0];

export function affineMatrix(value = identityMatrix()) {
  geometryInvariant(value?.length === 6 && Array.from(value).every(Number.isFinite),
    'SFD_GEOMETRY_MATRIX', 'An affine transform requires six finite coefficients.');
  return Array.from(value);
}

/** Composition applies right first, then left. */
export function multiplyMatrix(left, right) {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j,
    a * k + c * l + e, b * k + d * l + f];
}

export function inverseMatrix(value) {
  const [a, b, c, d, e, f] = affineMatrix(value);
  const determinant = a * d - b * c;
  geometryInvariant(Math.abs(determinant) > 1e-12, 'SFD_GEOMETRY_SINGULAR',
    'This transform has no inverse. Restore a nonzero scale before editing.');
  return [d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * f - d * e) / determinant, (b * e - a * f) / determinant];
}

export function transformPoint(matrix, point) {
  return {x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5]};
}

export function transformVector(matrix, point) {
  return {x: matrix[0] * point.x + matrix[2] * point.y, y: matrix[1] * point.x + matrix[3] * point.y};
}

export function translationMatrix(x, y) {
  return [1, 0, 0, 1, x, y];
}

/** Build a root-to-leaf transform, including scroll offsets and transform origins. */
export function coordinateStack(frames, viewport = identityMatrix()) {
  geometryInvariant(Array.isArray(frames) && frames.length <= 128, 'SFD_GEOMETRY_DEPTH', 'Coordinate nesting exceeds 128 frames.');
  let result = affineMatrix(viewport);
  for (const frame of frames) {
    const origin = frame.origin ?? {x: 0, y: 0};
    const offset = translationMatrix((frame.x ?? 0) - (frame.scrollX ?? 0), (frame.y ?? 0) - (frame.scrollY ?? 0));
    const transformed = multiplyMatrix(translationMatrix(origin.x, origin.y),
      multiplyMatrix(affineMatrix(frame.transform), translationMatrix(-origin.x, -origin.y)));
    result = multiplyMatrix(result, multiplyMatrix(offset, transformed));
  }
  return affineMatrix(result);
}

export function designRectangle(value) {
  const rectangle = {Left: value.Left ?? value.x ?? 0, Top: value.Top ?? value.y ?? 0,
    Width: value.Width ?? value.width, Height: value.Height ?? value.height};
  geometryInvariant(Object.values(rectangle).every(Number.isFinite) && rectangle.Width >= 0 && rectangle.Height >= 0,
    'SFD_GEOMETRY_RECTANGLE', 'Bounds require finite coordinates and nonnegative dimensions.');
  return rectangle;
}

export function rectanglePoints(value, matrix = identityMatrix()) {
  const {Left, Top, Width, Height} = designRectangle(value);
  return [{x: Left, y: Top}, {x: Left + Width, y: Top}, {x: Left + Width, y: Top + Height},
    {x: Left, y: Top + Height}].map(point => transformPoint(matrix, point));
}

export function boundsOfPoints(points) {
  geometryInvariant(points.length > 0, 'SFD_GEOMETRY_EMPTY', 'At least one point is required.');
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  return designRectangle({Left: left, Top: top, Width: right - left, Height: bottom - top});
}

export function transformRectangle(rectangle, matrix) {
  return boundsOfPoints(rectanglePoints(rectangle, matrix));
}

export function unionRectangles(rectangles) {
  return boundsOfPoints(rectangles.flatMap(rectangle => rectanglePoints(rectangle)));
}

export function rectanglesIntersect(left, right) {
  return left.Left <= right.Left + right.Width && left.Left + left.Width >= right.Left
    && left.Top <= right.Top + right.Height && left.Top + left.Height >= right.Top;
}

/** Pointer deltas are transformed without translation; zoom is part of localToClient. */
export function localPointerDelta(localToClient, start, current) {
  return transformVector(inverseMatrix(localToClient), {x: current.x - start.x, y: current.y - start.y});
}

/** Resize constraints retain the opposite edge; a dragged edge never inverts the rectangle. */
export function resizeRectangle(rectangle, handle, delta, constraints = {}) {
  const original = designRectangle(rectangle);
  geometryInvariant(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].includes(handle),
    'SFD_GEOMETRY_HANDLE', 'Unknown resize handle.');
  const minimumWidth = Math.max(0, constraints.minWidth ?? 0);
  const minimumHeight = Math.max(0, constraints.minHeight ?? 0);
  const maximumWidth = constraints.maxWidth ?? Infinity;
  const maximumHeight = constraints.maxHeight ?? Infinity;
  const next = {...original};
  if (handle.includes('e') || handle.includes('w')) {
    const width = original.Width + (handle.includes('w') ? -delta.x : delta.x);
    next.Width = Math.max(minimumWidth, Math.min(maximumWidth, width));
    if (handle.includes('w')) next.Left = original.Left + original.Width - next.Width;
  }
  if (handle.includes('n') || handle.includes('s')) {
    const height = original.Height + (handle.includes('n') ? -delta.y : delta.y);
    next.Height = Math.max(minimumHeight, Math.min(maximumHeight, height));
    if (handle.includes('n')) next.Top = original.Top + original.Height - next.Height;
  }
  return designRectangle(next);
}
