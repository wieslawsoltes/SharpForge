import {DrawingError, finite} from '../drawing/commands.js';

/** Scanbeam tessellator handles holes and intersections without assuming simple contours.
 * Work is bounded explicitly because an arrangement can contain quadratically many intersections.
 */
export function tessellateFill(contours, fillRule = 'evenodd', {maxTriangles = 2000000, maxWork = 10000000} = {}) {
  if (!['nonzero', 'evenodd'].includes(fillRule)) throw new DrawingError('SFRENDER041', 'Unknown fill rule');
  const events = [], triangles = [];
  let serial = 0;
  for (const contour of contours) {
    if (contour.filled === false) continue;
    const points = contour.points, count = points.length / 2;
    for (let index = 0; index < count; index++) {
      const next = (index + 1) % count;
      const ax = finite(points[index * 2]), ay = finite(points[index * 2 + 1]);
      const bx = finite(points[next * 2]), by = finite(points[next * 2 + 1]);
      if (ay === by) continue;
      const edge = {id: serial++, min: Math.min(ay, by), max: Math.max(ay, by),
        slope: (bx - ax) / (by - ay), x: ax, y: ay, winding: by > ay ? 1 : -1};
      events.push({y: edge.min, edge, add: true}, {y: edge.max, edge, add: false});
    }
  }
  events.sort((a, b) => a.y - b.y || Number(a.add) - Number(b.add) || a.edge.id - b.edge.id);
  const active = new Map();
  let at = 0, work = 0;
  const xAt = (edge, y) => edge.x + (y - edge.y) * edge.slope;
  const emit = (left, right, y0, y1) => {
    const l0 = xAt(left, y0), r0 = xAt(right, y0), l1 = xAt(left, y1), r1 = xAt(right, y1);
    if (Math.max(r0 - l0, r1 - l1) <= 1e-12 || y1 <= y0) return;
    triangles.push(l0, y0, r0, y0, l1, y1, l1, y1, r0, y0, r1, y1);
    if (triangles.length / 6 > maxTriangles) throw new DrawingError('SFRENDER042', 'Tessellation triangle budget exceeded');
  };
  while (at < events.length) {
    let bottom = events[at].y;
    while (at < events.length && events[at].y === bottom) {
      const event = events[at++];
      if (event.add) active.set(event.edge.id, event.edge); else active.delete(event.edge.id);
    }
    if (at === events.length || active.size < 2) continue;
    const ceiling = events[at].y;
    while (bottom < ceiling) {
      const epsilon = Math.min((ceiling - bottom) / 4, Math.max(1, Math.abs(bottom)) * Number.EPSILON * 16);
      const edges = [...active.values()].sort((a, b) => xAt(a, bottom + epsilon) - xAt(b, bottom + epsilon) || a.slope - b.slope);
      let top = ceiling;
      for (let index = 1; index < edges.length; index++) {
        const left = edges[index - 1], right = edges[index], divisor = left.slope - right.slope;
        if (divisor <= 0) continue;
        const crossing = bottom + (xAt(right, bottom) - xAt(left, bottom)) / divisor;
        if (crossing > bottom + epsilon && crossing < top) top = crossing;
      }
      const middle = (bottom + top) / 2;
      edges.sort((a, b) => xAt(a, middle) - xAt(b, middle) || a.id - b.id);
      let winding = 0, left = null;
      for (const edge of edges) {
        const before = fillRule === 'evenodd' ? (winding & 1) !== 0 : winding !== 0;
        winding += edge.winding;
        const after = fillRule === 'evenodd' ? (winding & 1) !== 0 : winding !== 0;
        if (!before && after) left = edge;
        else if (before && !after) { if (left) emit(left, edge, bottom, top); left = null; }
      }
      work += edges.length;
      if (work > maxWork) throw new DrawingError('SFRENDER042', 'Tessellation intersection work budget exceeded');
      if (top <= bottom) throw new DrawingError('SFRENDER043', 'Tessellation failed to advance its scanbeam');
      bottom = top;
    }
  }
  return new Float32Array(triangles);
}

export function trianglesContain(triangles, point) {
  const [x, y] = point;
  for (let index = 0; index < triangles.length; index += 6) {
    const ax = triangles[index], ay = triangles[index + 1], bx = triangles[index + 2], by = triangles[index + 3];
    const cx = triangles[index + 4], cy = triangles[index + 5];
    if (Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) <= 1e-12) continue;
    const ab = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const bc = (cx - bx) * (y - by) - (cy - by) * (x - bx);
    const ca = (ax - cx) * (y - cy) - (ay - cy) * (x - cx);
    if (ab >= -1e-8 && bc >= -1e-8 && ca >= -1e-8 || ab <= 1e-8 && bc <= 1e-8 && ca <= 1e-8) return true;
  }
  return false;
}
