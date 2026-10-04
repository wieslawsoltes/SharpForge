import {designRectangle, geometryInvariant} from './geometry-coordinates.js';

const axisNames = {x: ['Left', 'Width'], y: ['Top', 'Height']};
const rank = {guide: 0, edge: 1, baseline: 2, center: 3, spacing: 4, grid: 5};

function lowerBound(items, position) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle].position < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function axisTargets(name) {
  return {name, edge: new Map(), center: new Map(), baseline: new Map(), guide: new Map()};
}

function addTarget(axis, position, kind, target) {
  const lines = axis[kind];
  if (!lines.has(position)) lines.set(position, {axis: axis.name, position, kind, target});
}

function addRectangle(lines, rectangle) {
  const {Left, Top, Width, Height, id} = rectangle;
  addTarget(lines.x, Left, 'edge', id);
  addTarget(lines.x, Left + Width / 2, 'center', id);
  addTarget(lines.x, Left + Width, 'edge', id);
  addTarget(lines.y, Top, 'edge', id);
  addTarget(lines.y, Top + Height / 2, 'center', id);
  addTarget(lines.y, Top + Height, 'edge', id);
  if (Number.isFinite(rectangle.baseline)) {
    addTarget(lines.y, Top + rectangle.baseline, 'baseline', id);
  }
}

function addSpacing(lines, item) {
  const key = `${item.position}:${item.trailing}:${item.gap}`;
  if (!lines.has(key)) lines.set(key, item);
}

function prefer(candidate, best) {
  return !best || Math.abs(candidate.delta) < Math.abs(best.delta) - 1e-9
    || Math.abs(candidate.delta - best.delta) < 1e-9 && rank[candidate.kind] < rank[best.kind];
}

/** Sorted snap targets are built once per gesture. Queries cost O(log n + nearby targets). */
export class DesignSnaplines {
  constructor({siblings = [], parent = null, guides = [], tolerance = 6, gridSize = 8, snapGrid = false} = {}) {
    geometryInvariant(siblings.length <= 20000 && guides.length <= 256, 'SFD_SNAP_LIMIT', 'Snap target limit exceeded.');
    geometryInvariant(Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= 100,
      'SFD_SNAP_TOLERANCE', 'Snap tolerance must be between 0 and 100 design pixels.');
    geometryInvariant(Number.isFinite(gridSize) && gridSize > 0, 'SFD_SNAP_GRID', 'Snap grid size must be positive.');
    this.tolerance = tolerance;
    this.gridSize = gridSize;
    this.snapGrid = snapGrid;
    this.lines = {x: [], y: []};
    this.spacing = {x: [], y: []};
    const targets = {x: axisTargets('x'), y: axisTargets('y')};
    const rectangles = siblings.map(item => ({...designRectangle(item.bounds ?? item), id: item.id, baseline: item.baseline}));
    for (const rectangle of rectangles) addRectangle(targets, rectangle);
    if (parent) addRectangle(targets, {...designRectangle(parent.bounds ?? parent), id: parent.id ?? '$parent', baseline: parent.baseline});
    for (const guide of guides) {
      geometryInvariant(['x', 'y'].includes(guide.axis) && Number.isFinite(guide.position),
        'SFD_GUIDE_VALUE', 'Guides require an axis and a finite position.');
      const lines = targets[guide.axis].guide;
      if (!lines.has(guide.position)) lines.set(guide.position, {...guide, kind: 'guide', target: guide.id ?? '$guide'});
    }
    for (const [axis, [position, size]] of Object.entries(axisNames)) {
      const lines = targets[axis];
      this.lines[axis] = [...lines.guide.values(), ...lines.edge.values(), ...lines.baseline.values(), ...lines.center.values()];
      this.lines[axis].sort((left, right) => left.position - right.position || rank[left.kind] - rank[right.kind]);
      const sorted = [...rectangles];
      sorted.sort((left, right) => left[position] - right[position]);
      const spacing = new Map();
      for (let index = 1; index < sorted.length; index++) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        const gap = current[position] - previous[position] - previous[size];
        if (gap < 0) continue;
        addSpacing(spacing, {axis, position: current[position] + current[size] + gap,
          kind: 'spacing', target: current.id, other: previous.id, gap, trailing: false});
        addSpacing(spacing, {axis, position: previous[position] - gap,
          kind: 'spacing', target: previous.id, other: current.id, gap, trailing: true});
      }
      this.spacing[axis] = [...spacing.values()];
      this.spacing[axis].sort((left, right) => left.position - right.position || Number(left.trailing) - Number(right.trailing)
        || left.gap - right.gap);
    }
  }

  nearest(lines, value, filter = null) {
    const start = lowerBound(lines, value - this.tolerance);
    let best = null;
    for (let index = start; index < lines.length && lines[index].position <= value + this.tolerance; index++) {
      const line = lines[index];
      if (filter && !filter(line)) continue;
      const candidate = {...line, delta: line.position - value};
      if (prefer(candidate, best)) best = candidate;
    }
    return best;
  }

  snap(rectangle, {disabled = false, baseline = null, handle = null} = {}) {
    const bounds = designRectangle(rectangle);
    if (disabled) return {bounds, delta: {x: 0, y: 0}, guides: []};
    const delta = {x: 0, y: 0};
    const guides = [];
    for (const [axis, [position, size]] of Object.entries(axisNames)) {
      const active = axis === 'x' ? ['w', 'e'] : ['n', 's'];
      const fractions = handle ? [handle.includes(active[0]) ? 0 : handle.includes(active[1]) ? 1 : null]
        : [0, .5, 1];
      let best = null;
      for (const fraction of fractions) {
        if (fraction === null) continue;
        const value = bounds[position] + bounds[size] * fraction;
        const candidate = this.nearest(this.lines[axis], value, line => line.kind !== 'baseline');
        if (candidate && prefer(candidate, best)) best = {...candidate, sourceFraction: fraction};
      }
      if (!handle && axis === 'y' && Number.isFinite(baseline)) {
        const candidate = this.nearest(this.lines.y, bounds.Top + baseline, line => line.kind === 'baseline');
        if (candidate && prefer(candidate, best)) best = candidate;
      }
      if (!handle) {
        for (const trailing of [false, true]) {
          const candidate = this.nearest(this.spacing[axis], bounds[position] + (trailing ? bounds[size] : 0),
            line => line.trailing === trailing);
          if (candidate && prefer(candidate, best)) best = candidate;
        }
      }
      if (!best && this.snapGrid && fractions[0] !== null) {
        const fraction = handle ? fractions[0] : 0;
        const value = bounds[position] + bounds[size] * fraction;
        const snapped = Math.round(value / this.gridSize) * this.gridSize;
        best = {axis, kind: 'grid', delta: snapped - value, position: snapped, sourceFraction: fraction};
      }
      if (best) {
        delta[axis] = best.delta;
        guides.push(best);
      }
    }
    if (handle) {
      if (handle.includes('w')) {
        bounds.Left += delta.x;
        bounds.Width -= delta.x;
      } else if (handle.includes('e')) bounds.Width += delta.x;
      if (handle.includes('n')) {
        bounds.Top += delta.y;
        bounds.Height -= delta.y;
      } else if (handle.includes('s')) bounds.Height += delta.y;
    } else {
      bounds.Left += delta.x;
      bounds.Top += delta.y;
    }
    return {bounds: designRectangle(bounds), delta, guides};
  }
}
