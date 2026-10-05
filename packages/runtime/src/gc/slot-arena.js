import {ArenaLayout} from './spatial-layout.js';

/** Dense host slot blocks. Bytes here are managed accounting, not JS heap measurements. */
export class SlotArena extends ArenaLayout {
  constructor(id, capacity, space = 'small') {
    super(id, capacity, space);
    this.values = new Array(this.capacity / 8);
    this.hostBacked = true;
  }

  read(block, index) {
    return this.values[block.offset / 8 + index];
  }

  write(block, index, value) {
    this.values[block.offset / 8 + index] = value;
  }

  release(id) {
    const block = super.release(id);
    if (block) this.values.fill(undefined, block.offset / 8, (block.offset + block.allocatedBytes) / 8);
    return block;
  }

  move(block, destination) {
    this.values.copyWithin(destination / 8, block.offset / 8, (block.offset + block.allocatedBytes) / 8);
    block.offset = destination;
  }

  clearFreeSpace() {
    for (const block of this.free.blocks()) {
      this.values.fill(undefined, block.offset / 8, (block.offset + block.size) / 8);
    }
    this.values.fill(undefined, this.highWater / 8);
  }

  snapshot() {
    return {...super.snapshot(), hostBacked: true, values: [...this.values]};
  }

  static restore(state) {
    const arena = new SlotArena(state.id, state.capacity, state.space);
    arena.values = [...state.values];
    arena.restore(state);
    return arena;
  }
}
