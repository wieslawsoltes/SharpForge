function rect(value) {
  const result = Array.isArray(value) ? value : [value.x, value.y, value.width, value.height];
  if (result.length !== 4 || !result.every(Number.isFinite) || result[2] < 0 || result[3] < 0) {
    throw new RangeError('Damage rectangles must contain finite nonnegative extents');
  }
  return result;
}

function union(first, second) {
  const x = Math.min(first[0], second[0]);
  const y = Math.min(first[1], second[1]);
  return [x, y, Math.max(first[0] + first[2], second[0] + second[2]) - x,
    Math.max(first[1] + first[3], second[1] + second[3]) - y];
}

function intersects(first, second) {
  return first[0] <= second[0] + second[2] && second[0] <= first[0] + first[2]
    && first[1] <= second[1] + second[3] && second[1] <= first[1] + first[3];
}

/** Damage is meaningful only when a backend preserves an offscreen backing surface. */
export class DirtyRegions {
  constructor({width, height, maxRects = 64, fullThreshold = 0.6}) {
    if (!Number.isInteger(maxRects) || maxRects < 1 || maxRects > 1024) throw new RangeError('Invalid damage limit');
    if (!(fullThreshold > 0 && fullThreshold <= 1)) throw new RangeError('Invalid full-redraw threshold');
    this.maxRects = maxRects;
    this.fullThreshold = fullThreshold;
    this.layers = new Map();
    this.resize(width, height);
  }

  resize(width, height) {
    if (![width, height].every(value => Number.isFinite(value) && value >= 0 && value <= 65536)) {
      throw new RangeError('Invalid damage surface dimensions');
    }
    this.width = width;
    this.height = height;
    this.layers.clear();
    this.full = true;
  }

  add(layer, bounds, inflation = 0) {
    if (!Number.isFinite(inflation) || inflation < 0) throw new RangeError('Invalid damage inflation');
    const value = rect(bounds);
    const left = Math.max(0, Math.floor(value[0] - inflation));
    const top = Math.max(0, Math.floor(value[1] - inflation));
    const right = Math.min(this.width, Math.ceil(value[0] + value[2] + inflation));
    const bottom = Math.min(this.height, Math.ceil(value[1] + value[3] + inflation));
    if (right <= left || bottom <= top) return;
    let merged = [left, top, right - left, bottom - top];
    const rectangles = this.layers.get(layer) ?? [];
    for (let index = 0; index < rectangles.length;) {
      if (!intersects(merged, rectangles[index])) { index++; continue; }
      merged = union(merged, rectangles[index]);
      rectangles.splice(index, 1);
      index = 0;
    }
    rectangles.push(merged);
    if (rectangles.length > this.maxRects) rectangles.splice(0, rectangles.length, rectangles.reduce(union));
    this.layers.set(layer, rectangles);
  }

  moved(layer, before, after, inflation = 0) {
    if (before) this.add(layer, before, inflation);
    if (after) this.add(layer, after, inflation);
  }

  invalidateAll() { this.full = true; }

  consume({preservedContents = false} = {}) {
    const area = [...this.layers.values()].flat().reduce((sum, bounds) => sum + bounds[2] * bounds[3], 0);
    const surfaceArea = this.width * this.height;
    const full = this.full || !preservedContents || area >= surfaceArea * this.fullThreshold;
    const layers = full ? new Map([['root', [[0, 0, this.width, this.height]]]]) : this.layers;
    const damagedPixels = full ? surfaceArea : Math.min(surfaceArea, area);
    this.layers = new Map();
    this.full = false;
    return {full, layers, damagedPixels, fraction: surfaceArea ? damagedPixels / surfaceArea : 0};
  }
}
