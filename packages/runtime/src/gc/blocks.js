function countThrough(counts, generation) {
  let total = 0;
  for (let index = 0; index <= generation; index++) total += counts[index];
  return total;
}

/** Allocation-ordered handle blocks maintain live counts so entirely marked blocks never enter sweep. */
export class AllocationBlocks {
  constructor(heap, { blockSize = 128 } = {}) {
    if (!Number.isSafeInteger(blockSize) || blockSize < 1 || blockSize > 4096) {
      throw new RangeError('Block size must be between 1 and 4096 objects');
    }
    this.heap = heap;
    this.blockSize = blockSize;
    this.blocks = new Map();
    this.byGeneration = [new Set(), new Set(), new Set()];
    this.slots = [];
    this.nextId = 1;
    this.tailId = null;
    this.epoch = 0;
    this.generation = 2;
    this.candidates = new Set();
  }

  allocated(reference) {
    const record = this.heap.get(reference);
    if (record.space === 'frozen') return;
    let block = this.blocks.get(this.tailId);
    if (!block || block.entries.length === this.blockSize) {
      block = { id: this.nextId++, entries: [], counts: [0, 0, 0], marked: [0, 0, 0], epoch: this.epoch,
        markedTotal: 0, condemnedCount: 0 };
      this.blocks.set(block.id, block);
      this.tailId = block.id;
    }
    const generation = record.gcGeneration;
    const entry = { h: reference.h, g: reference.g, generation, markedEpoch: 0, blockId: block.id, index: block.entries.length };
    block.entries.push(entry);
    this.slots[reference.h] = entry;
    block.counts[generation]++;
    this.byGeneration[generation].add(block.id);
    if (this.epoch && generation <= this.generation) this.candidates.add(block.id);
    if (block.epoch === this.epoch && generation <= this.generation) block.condemnedCount++;
  }

  /** Set up candidates per block, never per historical handle-table slot. */
  begin(epoch, generation) {
    this.epoch = epoch;
    this.generation = generation;
    this.candidates.clear();
    for (let index = 0; index <= generation; index++) {
      for (const blockId of this.byGeneration[index]) this.candidates.add(blockId);
    }
  }

  mark(reference) {
    const entry = this.slots[reference.h];
    if (!entry || entry.g !== reference.g || entry.markedEpoch === this.epoch) return;
    const block = this.blocks.get(entry.blockId);
    if (block.epoch !== this.epoch) {
      block.epoch = this.epoch;
      block.marked.fill(0);
      block.markedTotal = 0;
      block.condemnedCount = countThrough(block.counts, this.generation);
    }
    entry.markedEpoch = this.epoch;
    block.marked[entry.generation]++;
    if (entry.generation <= this.generation) block.markedTotal++;
    if (block.markedTotal >= block.condemnedCount) this.candidates.delete(block.id);
  }

  updateCandidate(block) {
    const marked = block.epoch === this.epoch ? countThrough(block.marked, this.generation) : 0;
    const live = countThrough(block.counts, this.generation);
    block.markedTotal = marked;
    block.condemnedCount = live;
    if (marked >= live) this.candidates.delete(block.id);
    else this.candidates.add(block.id);
  }

  promoted(reference, previousGeneration) {
    const entry = this.slots[reference.h];
    if (!entry || entry.g !== reference.g) return;
    const next = this.heap.records[reference.h].gcGeneration;
    if (next === previousGeneration) return;
    const block = this.blocks.get(entry.blockId);
    block.counts[previousGeneration]--;
    block.counts[next]++;
    if (block.counts[previousGeneration] === 0) this.byGeneration[previousGeneration].delete(block.id);
    this.byGeneration[next].add(block.id);
    if (entry.markedEpoch === this.epoch && block.epoch === this.epoch) {
      block.marked[previousGeneration]--;
      block.marked[next]++;
    }
    entry.generation = next;
    this.updateCandidate(block);
  }

  released(reference) {
    const entry = this.slots[reference.h];
    if (!entry || entry.g !== reference.g) return;
    const block = this.blocks.get(entry.blockId);
    block.entries[entry.index] = null;
    block.counts[entry.generation]--;
    if (entry.markedEpoch === this.epoch && block.epoch === this.epoch) block.marked[entry.generation]--;
    if (block.counts[entry.generation] === 0) this.byGeneration[entry.generation].delete(block.id);
    this.slots[reference.h] = null;
    if (countThrough(block.counts, 2) === 0) {
      this.blocks.delete(block.id);
      this.candidates.delete(block.id);
    } else {
      this.updateCandidate(block);
    }
  }

  snapshot() {
    return { blockSize: this.blockSize, nextId: this.nextId, tailId: this.tailId, epoch: this.epoch, generation: this.generation,
      candidates: [...this.candidates], blocks: [...this.blocks.values()].map(block => ({ ...block,
        counts: [...block.counts], marked: [...block.marked], entries: block.entries.map(entry => entry ? { ...entry } : null) })) };
  }

  restore(state) {
    this.blocks.clear();
    this.slots = [];
    for (const generation of this.byGeneration) generation.clear();
    this.candidates.clear();
    if (!state) {
      this.nextId = 1;
      this.tailId = null;
      this.epoch = 0;
      for (let handle = 0; handle < this.heap.records.length; handle++) {
        const reference = this.heap.referenceAt(handle);
        if (reference) this.allocated(reference);
      }
      return;
    }
    Object.assign(this, { nextId: state.nextId, tailId: state.tailId, epoch: state.epoch, generation: state.generation });
    this.blockSize = state.blockSize ?? this.blockSize;
    this.candidates = new Set(state.candidates);
    for (const source of state.blocks) {
      const block = { ...source, counts: [...source.counts], marked: [...source.marked],
        entries: source.entries.map(entry => entry ? { ...entry } : null) };
      block.markedTotal ??= block.epoch === this.epoch ? countThrough(block.marked, this.generation) : 0;
      block.condemnedCount ??= countThrough(block.counts, this.generation);
      this.blocks.set(block.id, block);
      for (let generation = 0; generation < 3; generation++) {
        if (block.counts[generation]) this.byGeneration[generation].add(block.id);
      }
      for (const entry of block.entries) if (entry) this.slots[entry.h] = entry;
    }
  }
}
