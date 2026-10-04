import {DrawingError} from '../drawing/commands.js';

function limit(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new DrawingError('SFRENDER045', 'Invalid ' + name + ' budget');
  return value;
}
class DashBudget {
  constructor({maxDashWork = 1000000, maxDashContours = 100000, maxDashPoints = 1000000}) {
    this.maxWork = limit(maxDashWork, 'dash work');
    this.maxContours = limit(maxDashContours, 'dash contour');
    this.maxPoints = limit(maxDashPoints, 'dash point');
    this.work = 0;
    this.contours = 0;
    this.points = 0;
  }
  step() { if (++this.work > this.maxWork) throw new DrawingError('SFRENDER045', 'Dash splitting work budget exceeded'); }
  contour() { if (++this.contours > this.maxContours) throw new DrawingError('SFRENDER045', 'Dash contour budget exceeded'); }
  point() { if (++this.points > this.maxPoints) throw new DrawingError('SFRENDER045', 'Dash point budget exceeded'); }
}
function appendPoint(contour, x, y, budget) {
  const points = contour.points;
  if (points.length && points.at(-2) === x && points.at(-1) === y) return;
  budget.point();
  points.push(x, y);
}

class DashContourBuilder {
  constructor(pen, period, budget) {
    this.pattern = pen.dash;
    this.budget = budget;
    this.index = 0;
    let phase = ((pen.dashOffset % period) + period) % period;
    while (phase > 0 && phase >= this.pattern[this.index]) {
      budget.step();
      phase -= this.pattern[this.index];
      this.index = (this.index + 1) % this.pattern.length;
    }
    this.remaining = this.pattern[this.index] - phase;
    this.active = null;
    this.pieces = [];
    this.hasGap = false;
  }
  start(x, y, direction = null) {
    this.budget.contour();
    const piece = {points: [], closed: false, filled: true, dashed: true, direction};
    appendPoint(piece, x, y, this.budget);
    this.pieces.push(piece);
    return piece;
  }
  advance(x, y, direction, emitZero = true) {
    while (this.remaining === 0) {
      this.budget.step();
      if (emitZero && this.pattern[this.index] === 0 && (this.index & 1) === 0 && !this.active) this.start(x, y, direction);
      this.index = (this.index + 1) % this.pattern.length;
      this.remaining = this.pattern[this.index];
    }
  }
  segment(ax, ay, bx, by) {
    this.budget.step();
    const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy);
    if (!Number.isFinite(length)) throw new DrawingError('SFRENDER045', 'Nonfinite dash segment length');
    if (!length) return null;
    const direction = [dx / length, dy / length];
    let at = 0;
    while (at < length) {
      this.budget.step();
      const x = at === 0 ? ax : ax + dx * at / length;
      const y = at === 0 ? ay : ay + dy * at / length;
      this.advance(x, y, direction);
      const take = Math.min(this.remaining, length - at);
      const end = take === length - at ? length : at + take;
      if (end <= at) throw new DrawingError('SFRENDER045', 'Dash interval cannot advance at this coordinate scale');
      if ((this.index & 1) === 0) {
        this.active ??= this.start(x, y);
        appendPoint(this.active, end === length ? bx : ax + dx * end / length, end === length ? by : ay + dy * end / length, this.budget);
      } else { this.active = null; this.hasGap = true; }
      this.remaining = take === this.remaining ? 0 : this.remaining - take;
      at = end;
    }
    return direction;
  }
}

function joinClosedSeam(builder, source) {
  const pieces = builder.pieces, first = pieces[0], last = pieces.at(-1);
  if (!first || first.points.length < 4 || last.points.length < 4) return;
  const beginsAtSeam = first.points[0] === source[0] && first.points[1] === source[1];
  const endsAtSeam = last.points.at(-2) === source[0] && last.points.at(-1) === source[1];
  if (!beginsAtSeam || !endsAtSeam) return;
  if (first === last && !builder.hasGap) {
    first.points.length -= 2;
    first.closed = true;
  } else if (first !== last) {
    for (let index = 2; index < first.points.length; index++) last.points.push(first.points[index]);
    pieces[0] = last;
    pieces.pop();
  }
}

function contourLength(points, closed, budget) {
  if (points.length % 2) throw new DrawingError('SFRENDER045', 'Dash contour needs coordinate pairs');
  let length = 0;
  const count = points.length / 2;
  for (let index = 0; index < count - (closed ? 0 : 1); index++) {
    budget.step();
    const next = (index + 1) % count;
    length += Math.hypot(points[next * 2] - points[index * 2], points[next * 2 + 1] - points[index * 2 + 1]);
  }
  if (!Number.isFinite(length)) throw new DrawingError('SFRENDER045', 'Nonfinite dash contour length');
  return length;
}

/** O(input vertices + emitted intervals), with explicit splitting work, contour and point budgets. */
export function dashContours(contours, pen, options = {}) {
  if (!pen.dash.length) return contours;
  const period = pen.dash.reduce((sum, value) => sum + value, 0);
  if (!(period > 0) || !Number.isFinite(period)) throw new DrawingError('SFRENDER044', 'Dash pattern must advance');
  const budget = new DashBudget(options);
  const result = [];
  for (const contour of contours) {
    const source = contour.points;
    if (!source.length) continue;
    const length = contourLength(source, contour.closed, budget);
    if (Math.floor(length / period) * pen.dash.length > budget.maxWork - budget.work) {
      throw new DrawingError('SFRENDER045', 'Dash splitting work budget exceeded');
    }
    const builder = new DashContourBuilder(pen, period, budget);
    const count = source.length / 2;
    let direction = [1, 0];
    for (let index = 0; index < count - (contour.closed ? 0 : 1); index++) {
      const next = (index + 1) % count;
      direction = builder.segment(source[index * 2], source[index * 2 + 1], source[next * 2], source[next * 2 + 1]) ?? direction;
    }
    builder.advance(contour.closed ? source[0] : source.at(-2), contour.closed ? source[1] : source.at(-1), direction, !contour.closed || !length);
    if (!length && (builder.index & 1) === 0 && !builder.pieces.length) builder.start(source[0], source[1], direction);
    if (contour.closed) joinClosedSeam(builder, source);
    for (const piece of builder.pieces) result.push(piece);
  }
  return result;
}
