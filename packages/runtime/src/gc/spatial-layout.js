import {FreeSpaceIndex} from './free-space-index.js';

export function alignStorage(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > Number.MAX_SAFE_INTEGER - 7) {
    throw new RangeError('Storage byte length exceeds the safe integer range');
  }
  return Math.ceil(Math.max(1, bytes) / 8) * 8;
}

/** Allocation metadata shared by byte arenas and host slot arenas. */
export class ArenaLayout {
  constructor(id, capacity, space) {
    this.id = id;
    this.capacity = alignStorage(capacity);
    this.space = space;
    this.highWater = 0;
    this.blocks = new Map();
    this.free = new FreeSpaceIndex();
    this.liveBytes = 0;
  }

  get available() {
    return Math.max(this.capacity - this.highWater, this.free.largest);
  }

  fitSize(bytes) {
    const hole = this.free.find(bytes);
    const tail = this.capacity - this.highWater;
    return Math.min(hole?.size ?? Infinity, tail >= bytes ? tail : Infinity);
  }

  allocate(id, byteLength) {
    const size = alignStorage(byteLength);
    if (this.blocks.has(id)) throw new Error('Arena invariant: duplicate block identity');
    const candidate = this.free.find(size);
    const tail = this.capacity - this.highWater;
    const hole = candidate && (tail < size || candidate.size <= tail) ? this.free.take(size) : null;
    let offset = hole?.offset;
    if (hole && hole.size > size) this.free.add(hole.offset + size, hole.size - size);
    if (!hole) {
      if (this.highWater + size > this.capacity) return null;
      offset = this.highWater;
      this.highWater += size;
    }
    const block = {id, offset, byteLength, allocatedBytes: size, reference: null};
    this.blocks.set(id, block);
    this.liveBytes += size;
    return block;
  }

  release(id) {
    const block = this.blocks.get(id);
    if (!block) return null;
    block.released = true;
    this.blocks.delete(id);
    this.liveBytes -= block.allocatedBytes;
    this.free.add(block.offset, block.allocatedBytes);
    const tail = this.free.takeEndingAt(this.highWater);
    if (tail) this.highWater = tail.offset;
    return block;
  }

  /** Rebuild free gaps after an ordered sliding plan has updated block offsets. */
  rebuild() {
    this.free.clear();
    let cursor = 0;
    const blocks = [...this.blocks.values()].sort((left, right) => left.offset - right.offset);
    for (const block of blocks) {
      if (block.offset < cursor) throw new Error('Arena invariant: overlapping allocated blocks');
      if (block.offset > cursor) this.free.add(cursor, block.offset - cursor);
      cursor = block.offset + block.allocatedBytes;
    }
    if (cursor > this.capacity) throw new Error('Arena invariant: allocation exceeds capacity');
    this.highWater = cursor;
  }

  memoryInfo() {
    return {
      reservedBytes: this.capacity,
      liveBytes: this.liveBytes,
      freeBytes: this.capacity - this.liveBytes,
      fragmentedBytes: this.free.bytes,
      largestFreeBlock: this.available,
      objects: this.blocks.size
    };
  }

  snapshot() {
    return {
      id: this.id,
      capacity: this.capacity,
      space: this.space,
      highWater: this.highWater,
      blocks: [...this.blocks.values()].map(block => ({...block}))
    };
  }

  restore(state) {
    this.blocks.clear();
    this.liveBytes = 0;
    for (const saved of state.blocks) {
      const block = {...saved};
      this.blocks.set(block.id, block);
      this.liveBytes += block.allocatedBytes;
    }
    this.rebuild();
  }
}
