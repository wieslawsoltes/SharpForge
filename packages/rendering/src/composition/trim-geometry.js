import {flattenGeometry} from '../geometry/geometry-math.js';

/** Trims flattened contour length while preserving contour breaks and wraparound. */
export function trimGeometry(geometry, {start = 0, end = 1, offset = 0} = {}) {
  if (start === 0 && end === 1) return geometry;
  const contours = flattenGeometry(geometry, {tolerance: 0.1});
  const segments = [];
  let length = 0;
  for (let contour = 0; contour < contours.length; contour++) {
    const {points, closed} = contours[contour];
    const count = points.length / 2;
    for (let index = 0; index < count - 1 + Number(closed); index++) {
      const next = (index + 1) % count;
      const from = [points[index * 2], points[index * 2 + 1]];
      const to = [points[next * 2], points[next * 2 + 1]];
      const size = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (size) segments.push({from, to, start: length, size, contour});
      length += size;
    }
  }
  if (!length || end <= start) return {kind: 'path', figures: []};
  const phase = ((start + offset) % 1 + 1) % 1;
  const finish = phase + end - start;
  const ranges = finish > 1 ? [[phase * length, length], [0, (finish - 1) * length]] : [[phase * length, finish * length]];
  const figures = [];
  for (const [begin, stop] of ranges) {
    let figure = null;
    let previousContour = -1;
    for (const segment of segments) {
      const low = Math.max(begin, segment.start);
      const high = Math.min(stop, segment.start + segment.size);
      if (high <= low) continue;
      const interpolate = distance => segment.from.map((value, index) => value + (segment.to[index] - value) * distance / segment.size);
      if (!figure || previousContour !== segment.contour) {
        figure = {start: interpolate(low - segment.start), segments: [], closed: false, filled: false};
        figures.push(figure);
      }
      figure.segments.push({kind: 'line', end: interpolate(high - segment.start)});
      previousContour = segment.contour;
    }
  }
  return {kind: 'path', figures, fillRule: geometry.fillRule ?? 'nonzero'};
}
