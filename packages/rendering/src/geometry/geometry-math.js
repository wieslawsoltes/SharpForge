import {finite, DrawingError} from '../drawing/commands.js';
import {IDENTITY, multiply, transformPoint} from '../media/transforms.js';
import {geometryToPath} from './path-geometry.js';
import {arcParameters, arcPoint, angleInArc, cubicAt, cubicExtrema, flattenCubic, distanceSquared} from './curves.js';

/** Tight axis-aligned bounds including extrema of transformed Beziers and exact elliptical arcs. */
export function geometryBounds(input, transform = IDENTITY) {
  const path = geometryToPath(input), base = multiply(transform, path.transform ?? IDENTITY);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const include = point => { left = Math.min(left, point[0]); top = Math.min(top, point[1]);
    right = Math.max(right, point[0]); bottom = Math.max(bottom, point[1]); };
  for (const figure of path.figures) {
    const matrix = multiply(base, figure.transform ?? IDENTITY);
    let current = figure.start;
    include(transformPoint(matrix, current));
    for (const segment of figure.segments) {
      const start = transformPoint(matrix, current), end = transformPoint(matrix, segment.end);
      include(end);
      if (segment.kind === 'cubic' || segment.kind === 'quadratic') {
        const first = transformPoint(matrix, segment.control1 ?? [current[0] + (segment.control[0] - current[0]) * 2 / 3,
          current[1] + (segment.control[1] - current[1]) * 2 / 3]);
        const second = transformPoint(matrix, segment.control2 ?? [segment.end[0] + (segment.control[0] - segment.end[0]) * 2 / 3,
          segment.end[1] + (segment.control[1] - segment.end[1]) * 2 / 3]);
        const times = [...cubicExtrema(start[0], first[0], second[0], end[0]), ...cubicExtrema(start[1], first[1], second[1], end[1])];
        for (const time of times) include([cubicAt(start[0], first[0], second[0], end[0], time),
          cubicAt(start[1], first[1], second[1], end[1], time)]);
      } else if (segment.kind === 'arc') {
        const arc = arcParameters(current, segment);
        if (arc) {
          const cosine = Math.cos(arc.angle), sine = Math.sin(arc.angle);
          const axisX = [(matrix[0] * cosine + matrix[2] * sine) * arc.radiusX,
            (matrix[1] * cosine + matrix[3] * sine) * arc.radiusX];
          const axisY = [(-matrix[0] * sine + matrix[2] * cosine) * arc.radiusY,
            (-matrix[1] * sine + matrix[3] * cosine) * arc.radiusY];
          for (let axis = 0; axis < 2; axis++) {
            const angle = Math.atan2(axisY[axis], axisX[axis]);
            for (const candidate of [angle, angle + Math.PI]) if (angleInArc(candidate, arc.startAngle, arc.sweep)) {
              include(transformPoint(matrix, arcPoint(arc, candidate)));
            }
          }
        }
      }
      current = segment.end;
    }
  }
  return left === Infinity ? [0, 0, 0, 0] : [left, top, right - left, bottom - top];
}

/** Flatten in target space so tolerance is stable under scale, skew, rotation and fractional DPR. */
export function flattenGeometry(input, {tolerance = 0.2, transform = IDENTITY, maxPoints = 1000000} = {}) {
  finite(tolerance, 'flatten tolerance', 1e-9, 1000);
  const path = geometryToPath(input), base = multiply(transform, path.transform ?? IDENTITY), result = [];
  let total = 0;
  for (const figure of path.figures) {
    const matrix = multiply(base, figure.transform ?? IDENTITY), points = [...transformPoint(matrix, figure.start)];
    let current = figure.start;
    for (const segment of figure.segments) {
      const start = transformPoint(matrix, current), end = transformPoint(matrix, segment.end);
      if (segment.kind === 'line') points.push(...end);
      else if (segment.kind === 'arc') {
        const arc = arcParameters(current, segment);
        if (!arc) points.push(...end);
        else {
          const scale = Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3]));
          const radius = Math.max(arc.radiusX, arc.radiusY) * scale;
          const step = radius > tolerance ? 2 * Math.acos(Math.max(-1, 1 - tolerance / radius)) : Math.PI / 2;
          const count = Math.max(1, Math.ceil(Math.abs(arc.sweep) / Math.max(step, 1e-6)));
          if (count > maxPoints) throw new DrawingError('SFRENDER038', 'Arc exceeds point budget');
          for (let index = 1; index < count; index++) points.push(...transformPoint(matrix,
            arcPoint(arc, arc.startAngle + arc.sweep * index / count)));
          points.push(...end);
        }
      } else {
        const first = transformPoint(matrix, segment.control1 ?? [current[0] + (segment.control[0] - current[0]) * 2 / 3,
          current[1] + (segment.control[1] - current[1]) * 2 / 3]);
        const second = transformPoint(matrix, segment.control2 ?? [segment.end[0] + (segment.control[0] - segment.end[0]) * 2 / 3,
          segment.end[1] + (segment.control[1] - segment.end[1]) * 2 / 3]);
        flattenCubic(start, first, second, end, tolerance, points, maxPoints);
      }
      current = segment.end;
      if (total + points.length / 2 > maxPoints) throw new DrawingError('SFRENDER038', 'Geometry exceeds point budget');
    }
    total += points.length / 2;
    if (total > maxPoints) throw new DrawingError('SFRENDER038', 'Geometry exceeds point budget');
    result.push({points, closed: !!figure.closed, filled: figure.filled !== false});
  }
  return result;
}

/** Winding-number membership; points on the outline count as inside. */
export function fillContains(input, point, options = {}) {
  const contours = Array.isArray(input) ? input : flattenGeometry(input, options);
  const fillRule = options.fillRule ?? input.fillRule ?? 'evenodd', [x, y] = point;
  let winding = 0;
  for (const contour of contours) {
    if (contour.filled === false) continue;
    const p = contour.points, count = p.length / 2;
    for (let index = 0; index < count; index++) {
      const next = (index + 1) % count, ax = p[index * 2], ay = p[index * 2 + 1], bx = p[next * 2], by = p[next * 2 + 1];
      if (distanceSquared(point, [ax, ay], [bx, by]) < 1e-16) return true;
      if ((ay <= y && by > y || by <= y && ay > y) && ax + (y - ay) * (bx - ax) / (by - ay) > x) winding += by > ay ? 1 : -1;
    }
  }
  return fillRule === 'evenodd' ? Math.abs(winding) % 2 === 1 : winding !== 0;
}
