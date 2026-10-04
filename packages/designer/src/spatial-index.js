import {designRectangle, geometryInvariant, rectanglesIntersect} from './geometry-coordinates.js';

/** Bounded uniform spatial index. O(c + k) queries; oversized queries fall back to O(n). */
export class DesignSpatialIndex {
  constructor({cellSize = 128, maxItems = 20000, maxCellsPerItem = 256} = {}) {
    geometryInvariant(Number.isFinite(cellSize) && cellSize > 0, 'SFD_SPATIAL_CELL', 'Cell size must be positive.');
    this.cellSize = cellSize;
    this.maxItems = maxItems;
    this.maxCellsPerItem = maxCellsPerItem;
    this.items = new Map();
    this.cells = new Map();
    this.large = new Set();
  }

  range(rectangle) {
    const scale = this.cellSize;
    return [Math.floor(rectangle.Left / scale), Math.floor(rectangle.Top / scale),
      Math.floor((rectangle.Left + rectangle.Width) / scale), Math.floor((rectangle.Top + rectangle.Height) / scale)];
  }

  keys(rectangle) {
    const [left, top, right, bottom] = this.range(rectangle);
    if ((right - left + 1) * (bottom - top + 1) > this.maxCellsPerItem) return null;
    const keys = [];
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) keys.push(`${x}:${y}`);
    }
    return keys;
  }

  set(id, rectangle, data = null) {
    geometryInvariant(typeof id === 'string' && id.length > 0, 'SFD_SPATIAL_ID', 'A spatial item requires an identifier.');
    geometryInvariant(this.items.has(id) || this.items.size < this.maxItems, 'SFD_SPATIAL_LIMIT', 'Spatial item limit exceeded.');
    const bounds = designRectangle(rectangle);
    this.delete(id);
    const keys = this.keys(bounds);
    this.items.set(id, {id, bounds, data, keys});
    if (!keys) this.large.add(id);
    for (const key of keys ?? []) {
      let bucket = this.cells.get(key);
      if (!bucket) this.cells.set(key, bucket = new Set());
      bucket.add(id);
    }
    return this;
  }

  delete(id) {
    const item = this.items.get(id);
    if (!item) return false;
    for (const key of item.keys ?? []) {
      const bucket = this.cells.get(key);
      bucket.delete(id);
      if (!bucket.size) this.cells.delete(key);
    }
    this.large.delete(id);
    return this.items.delete(id);
  }

  search(rectangle, {limit = this.maxItems, predicate = null} = {}) {
    const bounds = designRectangle(rectangle);
    const keys = this.keys(bounds);
    const candidates = keys ? new Set(this.large) : this.items.keys();
    for (const key of keys ?? []) {
      for (const id of this.cells.get(key) ?? []) candidates.add(id);
    }
    const output = [];
    for (const id of candidates) {
      const item = this.items.get(id);
      if (rectanglesIntersect(bounds, item.bounds) && (!predicate || predicate(item))) output.push(item);
      if (output.length >= limit) break;
    }
    return output;
  }

  clear() {
    this.items.clear();
    this.cells.clear();
    this.large.clear();
  }
}

/** Flatten once per document revision; row queries allocate only the requested viewport. */
export class DesignOutlineIndex {
  constructor(document, expanded = null) {
    const nodes = new Map(document.nodes.map(node => [node.id, node]));
    this.rows = [];
    this.positions = new Map();
    const pending = [{id: document.root, depth: 0, parentId: null}];
    const seen = new Set();
    while (pending.length) {
      const row = pending.pop();
      geometryInvariant(!seen.has(row.id) && nodes.has(row.id), 'SFD_OUTLINE_TREE', 'Outline contains a missing node or cycle.');
      seen.add(row.id);
      this.positions.set(row.id, this.rows.length);
      this.rows.push({...row, node: nodes.get(row.id)});
      if (expanded && !expanded.has(row.id)) continue;
      const children = nodes.get(row.id).children;
      for (let index = children.length - 1; index >= 0; index--) {
        pending.push({id: children[index], depth: row.depth + 1, parentId: row.id});
      }
    }
  }

  viewport({scrollTop = 0, height, rowHeight = 24, overscan = 4}) {
    geometryInvariant(Number.isFinite(height) && height >= 0 && rowHeight > 0,
      'SFD_OUTLINE_VIEWPORT', 'Outline viewport requires a nonnegative height and positive row height.');
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(this.rows.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
    return {rows: this.rows.slice(start, end), offset: start * rowHeight, totalHeight: this.rows.length * rowHeight};
  }
}
