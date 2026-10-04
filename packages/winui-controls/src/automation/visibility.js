import { transformPoint } from '../layout/render-properties.js';

const polygon = (rect, matrix) => [[rect.x, rect.y], [rect.x + rect.width, rect.y],
  [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]]
  .map(([x, y]) => matrix ? transformPoint(matrix, { x, y }) : { x, y });
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const area = points => points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length]; return sum + point.x * next.y - next.x * point.y;
}, 0);

/** Exact intersection for the affine rectangular clips shared by layout and input. */
function clipPolygon(subject, clip) {
  const direction = Math.sign(area(clip));
  if (!direction) return [];
  for (let index = 0; index < clip.length && subject.length; index++) {
    const a = clip[index], b = clip[(index + 1) % clip.length], input = subject;
    subject = [];
    let previous = input.at(-1), old = cross(a, b, previous) * direction;
    for (const point of input) {
      const next = cross(a, b, point) * direction;
      if ((next >= 0) !== (old >= 0)) {
        const ratio = old / (old - next);
        subject.push({ x: previous.x + (point.x - previous.x) * ratio, y: previous.y + (point.y - previous.y) * ratio });
      }
      if (next >= 0) subject.push(point);
      previous = point; old = next;
    }
  }
  return subject;
}

export function visibleAutomationGeometry(layout, viewport = null) {
  if (!layout || layout.bounds.width <= 0 || layout.bounds.height <= 0) return false;
  let shape = layout.renderSize && layout.worldTransform
    ? polygon({ x: 0, y: 0, ...layout.renderSize }, layout.worldTransform) : polygon(layout.bounds);
  for (const clip of layout.clips ?? []) {
    shape = clipPolygon(shape, polygon(clip.rect, clip.transform));
    if (shape.length < 3) return false;
  }
  if (viewport) shape = clipPolygon(shape, polygon(viewport));
  return shape.length >= 3 && Math.abs(area(shape)) > 1e-8;
}
