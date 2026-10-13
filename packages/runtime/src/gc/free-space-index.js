import {SpatialSizeIndex} from './spatial-size-index.js';

function compare(left, right) {
  return left.size - right.size || left.offset - right.offset;
}

/** Coalescing best-fit free blocks. Allocation and release are O(log n). */
export class FreeSpaceIndex {
  constructor() {
    this.sizes = new SpatialSizeIndex(compare);
    this.starts = new Map();
    this.ends = new Map();
    this.bytes = 0;
    this.observer = null;
    this.owner = null;
  }

  get root() {
    return this.sizes.root;
  }

  clear() {
    if (this.observer) {
      for (const block of this.starts.values()) this.observer.removeHole(this.owner, block);
    }
    this.sizes.clear();
    this.starts.clear();
    this.ends.clear();
    this.bytes = 0;
  }

  _remove(block) {
    this.sizes.remove(block);
    this.starts.delete(block.offset);
    this.ends.delete(block.offset + block.size);
    this.bytes -= block.size;
    this.observer?.removeHole(this.owner, block);
    return block;
  }

  add(offset, size) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 1) {
      throw new RangeError('Free block requires a non-negative offset and positive safe size');
    }
    const before = this.ends.get(offset);
    if (before) {
      this._remove(before);
      offset = before.offset;
      size += before.size;
    }
    const after = this.starts.get(offset + size);
    if (after) {
      this._remove(after);
      size += after.size;
    }
    const block = {offset, size};
    if (this.starts.has(offset)) throw new Error('Free-space invariant: duplicate block start');
    this.starts.set(offset, block);
    this.ends.set(offset + size, block);
    this.sizes.add(block);
    this.bytes += size;
    this.observer?.addHole(this.owner, block);
    return block;
  }

  find(size) {
    return this.sizes.find(size);
  }

  /** Remove the smallest available block at least size bytes; caller splits it. */
  take(size) {
    const best = this.find(size);
    return best ? this._remove(best) : null;
  }

  takeEndingAt(offset) {
    const block = this.ends.get(offset);
    return block ? this._remove(block) : null;
  }

  get largest() {
    return this.sizes.largest;
  }

  blocks() {
    return [...this.starts.values()].sort((left, right) => left.offset - right.offset);
  }
}
