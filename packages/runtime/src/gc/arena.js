import {ArenaLayout} from './spatial-layout.js';

/** Typed payload storage; release is metadata-only, and reuse zeroes the complete allocation. */
export class MemoryArena extends ArenaLayout {
  constructor(id, capacity, space = 'small') {
    super(id, capacity, space);
    this.buffer = new ArrayBuffer(this.capacity);
    this.bytes = new Uint8Array(this.buffer);
    this.view = new DataView(this.buffer);
    this.hostBacked = false;
  }

  allocate(id, byteLength) {
    const block = super.allocate(id, byteLength);
    if (block) this.bytes.fill(0, block.offset, block.offset + block.allocatedBytes);
    return block;
  }

  move(block, destination) {
    this.bytes.copyWithin(destination, block.offset, block.offset + block.allocatedBytes);
    block.offset = destination;
  }

  clearFreeSpace() {
    for (const block of this.free.blocks()) this.bytes.fill(0, block.offset, block.offset + block.size);
    this.bytes.fill(0, this.highWater);
  }

  snapshot() {
    return {...super.snapshot(), hostBacked: false, buffer: this.buffer.slice(0)};
  }

  static restore(state) {
    const arena = new MemoryArena(state.id, state.capacity, state.space);
    arena.bytes.set(new Uint8Array(state.buffer));
    arena.restore(state);
    return arena;
  }
}

export {alignStorage} from './spatial-layout.js';
