import {DrawingError, finite} from '../drawing/commands.js';
import {flattenGeometry} from './geometry-math.js';
import {tessellateFill, trianglesContain} from './tessellation.js';
import {dashContours} from './dash-contours.js';

export {dashContours} from './dash-contours.js';

const capNames = ['butt', 'square', 'round', 'triangle'];
const joinNames = ['miter', 'bevel', 'round'];

/** WinUI dash lengths and offsets are multiples of stroke thickness. */
export function normalizePen(pen) {
  if (!pen) return null;
  const width = finite(pen.width ?? pen.thickness ?? pen.StrokeThickness ?? 1, 'stroke width', 0, 1e6);
  const cap = value => typeof value === 'number' ? capNames[value] : value ?? 'butt';
  const requestedJoin = pen.join ?? pen.lineJoin;
  const join = typeof requestedJoin === 'number' ? joinNames[requestedJoin] : requestedJoin ?? 'miter';
  const startCap = cap(pen.startCap ?? pen.cap), endCap = cap(pen.endCap ?? pen.cap), dashCap = cap(pen.dashCap);
  if (![startCap, endCap, dashCap].every(value => capNames.includes(value)) || !joinNames.includes(join)) {
    throw new DrawingError('SFRENDER044', 'Unknown stroke cap or join');
  }
  const input = pen.dash ?? pen.dashes ?? pen.dashArray ?? [];
  if (!Number.isSafeInteger(input.length) || input.length > 1024) throw new DrawingError('SFRENDER044', 'Dash count exceeds budget');
  let dash = Array.from(input, value => finite(value, 'dash length', 0, 1e6));
  if (dash.length % 2) dash = [...dash, ...dash];
  if (dash.length && dash.every(value => value === 0)) throw new DrawingError('SFRENDER044', 'Dash pattern must advance');
  if (pen.dashUnits !== 'absolute') dash = dash.map(value => value * width);
  const offset = finite(pen.dashOffset ?? 0, 'dash offset') * (pen.dashUnits === 'absolute' ? 1 : width);
  return {width, brush: pen.brush ?? pen.color ?? pen.Brush ?? '#000000', startCap, endCap, dashCap, join,
    miterLimit: finite(pen.miterLimit ?? 10, 'miter limit', 1, 1e6), dash, dashOffset: offset, dashUnits: 'absolute'};
}

class StrokeOutput {
  constructor({maxStrokeVertices = 1000000, maxStrokePieces = 200000}) {
    if (![maxStrokeVertices, maxStrokePieces].every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new DrawingError('SFRENDER045', 'Invalid stroke output budget');
    }
    this.maxVertices = maxStrokeVertices;
    this.maxPieces = maxStrokePieces;
    this.vertices = 0;
    this.items = [];
  }
  push(contour) {
    this.vertices += contour.points.length / 2;
    if (this.vertices > this.maxVertices || this.items.length >= this.maxPieces) {
      throw new DrawingError('SFRENDER045', 'Stroke output budget exceeded');
    }
    this.items.push(contour);
  }
}

function polygon(points, output) {
  let area = 0;
  for (let index = 0; index < points.length; index += 2) {
    const next = (index + 2) % points.length;
    area += points[index] * points[next + 1] - points[next] * points[index + 1];
  }
  if (area < 0) {
    const reversed = [];
    for (let index = points.length - 2; index >= 0; index -= 2) reversed.push(points[index], points[index + 1]);
    points = reversed;
  }
  output.push({points, closed: true, filled: true});
}
function disc(center, radius, output, tolerance) {
  const count = Math.min(4096, Math.max(12, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - tolerance / Math.max(radius, tolerance))))));
  const points = [];
  for (let index = 0; index < count; index++) {
    const angle = index / count * Math.PI * 2;
    points.push(center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius);
  }
  polygon(points, output);
}
function cap(point, direction, radius, kind, output, tolerance) {
  if (kind === 'round') return disc(point, radius, output, tolerance);
  if (kind === 'butt') return;
  const [x, y] = point, [dx, dy] = direction, nx = -dy * radius, ny = dx * radius;
  if (kind === 'triangle') polygon([x + nx, y + ny, x + dx * radius, y + dy * radius, x - nx, y - ny], output);
  else polygon([x + nx, y + ny, x + nx + dx * radius, y + ny + dy * radius,
    x - nx + dx * radius, y - ny + dy * radius, x - nx, y - ny], output);
}

/** Build a nonzero union of stroke pieces. Tessellating that union avoids overlapping-alpha artifacts. */
export function strokeContours(contours, inputPen, options = {}) {
  const tolerance = finite(options.tolerance ?? 0.2, 'stroke tolerance', Number.EPSILON, 1e6);
  const pen = normalizePen(inputPen), result = new StrokeOutput(options);
  if (!pen || !pen.width) return result.items;
  const radius = pen.width / 2;
  for (const contour of dashContours(contours, pen, options)) {
    const points = contour.points, count = points.length / 2, segments = [];
    for (let index = 0; index < count - (contour.closed ? 0 : 1); index++) {
      const next = (index + 1) % count, a = [points[index * 2], points[index * 2 + 1]], b = [points[next * 2], points[next * 2 + 1]];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!length) continue;
      const direction = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], normal = [-direction[1] * radius, direction[0] * radius];
      segments.push({a, b, direction, normal});
      polygon([a[0] + normal[0], a[1] + normal[1], b[0] + normal[0], b[1] + normal[1],
        b[0] - normal[0], b[1] - normal[1], a[0] - normal[0], a[1] - normal[1]], result);
    }
    if (!segments.length) {
      if (count) {
        const kind = contour.dashed ? pen.dashCap : pen.startCap;
        const center = [points[0], points[1]];
        const direction = contour.direction ?? [1, 0];
        cap(center, direction, radius, kind, result, tolerance);
        if (kind !== 'round') cap(center, direction.map(value => -value), radius, kind, result, tolerance);
      }
      continue;
    }
    for (let index = 0; index < segments.length - (contour.closed ? 0 : 1); index++) {
      const first = segments[index], second = segments[(index + 1) % segments.length], point = first.b;
      const turn = first.direction[0] * second.direction[1] - first.direction[1] * second.direction[0];
      if (Math.abs(turn) < 1e-12) continue;
      if (pen.join === 'round') { disc(point, radius, result, tolerance); continue; }
      const sign = turn > 0 ? -1 : 1;
      const a = [point[0] + first.normal[0] * sign, point[1] + first.normal[1] * sign];
      const b = [point[0] + second.normal[0] * sign, point[1] + second.normal[1] * sign];
      const distance = ((b[0] - a[0]) * second.direction[1] - (b[1] - a[1]) * second.direction[0]) / turn;
      const miter = [a[0] + distance * first.direction[0], a[1] + distance * first.direction[1]];
      const points = [point[0], point[1], a[0], a[1]];
      if (pen.join === 'miter' && Math.hypot(miter[0] - point[0], miter[1] - point[1]) <= pen.miterLimit * radius) points.push(...miter);
      points.push(...b);
      polygon(points, result);
    }
    if (!contour.closed) {
      const first = segments[0], last = segments.at(-1);
      cap(first.a, first.direction.map(value => -value), radius, contour.dashed ? pen.dashCap : pen.startCap, result, tolerance);
      cap(last.b, last.direction, radius, contour.dashed ? pen.dashCap : pen.endCap, result, tolerance);
    }
  }
  return result.items;
}

export function tessellateStroke(contours, pen, options) { return tessellateFill(strokeContours(contours, pen, options), 'nonzero', options); }
export function strokeContains(geometry, point, pen, options = {}) {
  return trianglesContain(tessellateStroke(Array.isArray(geometry) ? geometry : flattenGeometry(geometry, options), pen, options), point);
}
