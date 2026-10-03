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

function addRectangle(lines, item) {
  const rectangle = designRectangle(item.bounds ?? item);
  for (const [axis, [position, size]] of Object.entries(axisNames)) {
    lines[axis].push({axis, position: rectangle[position], kind: 'edge', target: item.id},
      {axis, position: rectangle[position] + rectangle[size] / 2, kind: 'center', target: item.id},
      {axis, position: rectangle[position] + rectangle[size], kind: 'edge', target: item.id});
  }
  if (Number.isFinite(item.baseline)) {
    lines.y.push({axis: 'y', position: rectangle.Top + item.baseline, kind: 'baseline', target: item.id});
  }
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
    for (const sibling of siblings) addRectangle(this.lines, sibling);
    if (parent) addRectangle(this.lines, {...parent, id: parent.id ?? '$parent'});
    for (const guide of guides) {
      geometryInvariant(['x', 'y'].includes(guide.axis) && Number.isFinite(guide.position),
        'SFD_GUIDE_VALUE', 'Guides require an axis and a finite position.');
      this.lines[guide.axis].push({...guide, kind: 'guide', target: guide.id ?? '$guide'});
    }
    for (const [axis, [position, size]] of Object.entries(axisNames)) {
      this.lines[axis].sort((left, right) => left.position - right.position || rank[left.kind] - rank[right.kind]);
      const sorted = siblings.map(item => ({id: item.id, ...designRectangle(item.bounds ?? item)}));
      sorted.sort((left, right) => left[position] - right[position]);
      for (let index = 1; index < sorted.length; index++) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        const gap = current[position] - previous[position] - previous[size];
        if (gap < 0) continue;
        this.spacing[axis].push({axis, position: current[position] + current[size] + gap,
          kind: 'spacing', target: current.id, other: previous.id, gap, trailing: false});
        this.spacing[axis].push({axis, position: previous[position] - gap,
          kind: 'spacing', target: previous.id, other: current.id, gap, trailing: true});
      }
      this.spacing[axis].sort((left, right) => left.position - right.position);
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
