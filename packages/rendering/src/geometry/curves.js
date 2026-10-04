import {DrawingError} from '../drawing/commands.js';

const tau = Math.PI * 2;
export function quadraticAt(start, control, end, time) {
  const inverse = 1 - time;
  return start * inverse * inverse + 2 * control * inverse * time + end * time * time;
}
export function cubicAt(start, control1, control2, end, time) {
  const inverse = 1 - time;
  return inverse ** 3 * start + 3 * inverse ** 2 * time * control1 + 3 * inverse * time ** 2 * control2 + time ** 3 * end;
}
export function cubicExtrema(start, control1, control2, end) {
  const a = -start + 3 * control1 - 3 * control2 + end, b = 2 * (start - 2 * control1 + control2), c = control1 - start;
  if (Math.abs(a) < 1e-14) return Math.abs(b) < 1e-14 ? [] : [-c / b].filter(value => value > 0 && value < 1);
  const determinant = b * b - 4 * a * c;
  if (determinant < 0) return [];
  const root = Math.sqrt(determinant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)].filter(value => value > 0 && value < 1);
}

/** SVG endpoint-to-center arc conversion, including required radius correction. */
export function arcParameters(start, segment) {
  const end = segment.end;
  let [radiusX, radiusY] = segment.radius.map(Math.abs);
  if (!radiusX || !radiusY || start[0] === end[0] && start[1] === end[1]) return null;
  const angle = (segment.rotation ?? 0) * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  const dx = (start[0] - end[0]) / 2, dy = (start[1] - end[1]) / 2;
  const localX = cosine * dx + sine * dy, localY = -sine * dx + cosine * dy;
  const correction = localX ** 2 / radiusX ** 2 + localY ** 2 / radiusY ** 2;
  if (correction > 1) { const scale = Math.sqrt(correction); radiusX *= scale; radiusY *= scale; }
  const denominator = radiusX ** 2 * localY ** 2 + radiusY ** 2 * localX ** 2;
  const factor = (segment.large === segment.clockwise ? -1 : 1) * Math.sqrt(Math.max(0,
    (radiusX ** 2 * radiusY ** 2 - denominator) / denominator));
  const centerX = factor * radiusX * localY / radiusY, centerY = -factor * radiusY * localX / radiusX;
  const center = [cosine * centerX - sine * centerY + (start[0] + end[0]) / 2,
    sine * centerX + cosine * centerY + (start[1] + end[1]) / 2];
  const ux = (localX - centerX) / radiusX, uy = (localY - centerY) / radiusY;
  const vx = (-localX - centerX) / radiusX, vy = (-localY - centerY) / radiusY;
  const startAngle = Math.atan2(uy, ux);
  let sweep = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!segment.clockwise && sweep > 0) sweep -= tau;
  if (segment.clockwise && sweep < 0) sweep += tau;
  return {center, radiusX, radiusY, angle, startAngle, sweep};
}
export function arcPoint(parameters, angle) {
  const {center, radiusX, radiusY, angle: rotation} = parameters;
  const x = radiusX * Math.cos(angle), y = radiusY * Math.sin(angle), cosine = Math.cos(rotation), sine = Math.sin(rotation);
  return [center[0] + cosine * x - sine * y, center[1] + sine * x + cosine * y];
}
export function angleInArc(angle, start, sweep) {
  const normalized = ((sweep >= 0 ? angle - start : start - angle) % tau + tau) % tau;
  return normalized <= Math.abs(sweep) + 1e-12;
}
export function arcToCubics(start, segment) {
  const parameters = arcParameters(start, segment);
  if (!parameters) return [{kind: 'line', end: segment.end}];
  const count = Math.max(1, Math.ceil(Math.abs(parameters.sweep) / (Math.PI / 2))), step = parameters.sweep / count;
  const result = [];
  for (let index = 0; index < count; index++) {
    const angle = parameters.startAngle + step * index, next = angle + step, factor = 4 / 3 * Math.tan(step / 4);
    const begin = arcPoint(parameters, angle), end = arcPoint(parameters, next);
    const derivative = at => {
      const x = -parameters.radiusX * Math.sin(at), y = parameters.radiusY * Math.cos(at);
      return [Math.cos(parameters.angle) * x - Math.sin(parameters.angle) * y,
        Math.sin(parameters.angle) * x + Math.cos(parameters.angle) * y];
    };
    const first = derivative(angle), second = derivative(next);
    result.push({kind: 'cubic', control1: [begin[0] + factor * first[0], begin[1] + factor * first[1]],
      control2: [end[0] - factor * second[0], end[1] - factor * second[1]], end});
  }
  result[result.length - 1].end = segment.end;
  return result;
}

const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const distanceSquared = (point, start, end) => {
  const dx = end[0] - start[0], dy = end[1] - start[1], length = dx * dx + dy * dy;
  if (!length) return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2;
  const time = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length));
  return (point[0] - start[0] - time * dx) ** 2 + (point[1] - start[1] - time * dy) ** 2;
};
export {distanceSquared};

/** Iterative adaptive de Casteljau flattening; bounded stack and output, no recursion on untrusted paths. */
export function flattenCubic(start, first, second, end, tolerance, output, maxPoints = 1000000) {
  const stack = [[start, first, second, end, 0]], squared = tolerance * tolerance;
  while (stack.length) {
    const [a, b, c, d, depth] = stack.pop();
    if (Math.max(distanceSquared(b, a, d), distanceSquared(c, a, d)) <= squared || depth === 24) {
      output.push(d[0], d[1]);
      if (output.length > maxPoints * 2) throw new DrawingError('SFRENDER038', 'Flattened geometry exceeds point budget');
      continue;
    }
    const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d), abc = midpoint(ab, bc), bcd = midpoint(bc, cd);
    const center = midpoint(abc, bcd);
    stack.push([center, bcd, cd, d, depth + 1], [a, ab, abc, center, depth + 1]);
  }
}
