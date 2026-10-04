import {inverseMatrix, multiplyMatrix, transformRectangle} from '@sharpforge/designer';

/** Text aligns only when its baseline is parallel to its parent's horizontal axis. */
export function localSnapBaseline(entry, origin, matrix) {
  if (!Number.isFinite(entry.baseline)) return null;
  matrix ??= multiplyMatrix(inverseMatrix(entry.parentMatrix), entry.matrix);
  if (Math.abs(matrix[1]) > 1e-8) return null;
  return matrix[3] * entry.baseline + matrix[5] - origin;
}

/** A target is relative to its layout parent, so scrolling the outer designer viewport cannot change it. */
export function localSnapTarget(entry, matrix = multiplyMatrix(inverseMatrix(entry.parentMatrix), entry.matrix)) {
  const bounds = transformRectangle({Width: entry.width, Height: entry.height}, matrix);
  return {id: entry.id, bounds, baseline: localSnapBaseline(entry, bounds.Top, matrix)};
}
