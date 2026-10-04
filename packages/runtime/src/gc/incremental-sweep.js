/** Lazy block sweep never visits wholly marked blocks and charges every examined block slot to the slice. */
export class IncrementalSweep {
  constructor(heap, blocks, marker, state = null) {
    this.heap = heap;
    this.blocks = blocks;
    this.marker = marker;
    this.blockIds = state ? [...state.blockIds] : [...blocks.candidates];
    this.blockIndex = state?.blockIndex ?? 0;
    this.entryIndex = state?.entryIndex ?? 0;
    this.statistics = state ? { ...state.statistics } : { blocksVisited: 0, slotsVisited: 0,
      freedObjects: 0, freedBytes: 0, maxSliceWork: 0 };
  }

  get done() {
    return this.blockIndex >= this.blockIds.length;
  }

  step(budget) {
    let work = 0;
    while (work < budget && !this.done) {
      const blockId = this.blockIds[this.blockIndex];
      const block = this.blocks.blocks.get(blockId);
      if (!block || !this.blocks.candidates.has(blockId)) {
        this.blockIndex++;
        this.entryIndex = 0;
        work++;
        continue;
      }
      if (this.entryIndex === 0) this.statistics.blocksVisited++;
      const entry = block.entries[this.entryIndex++];
      work++;
      this.statistics.slotsVisited++;
      if (entry && entry.generation <= this.marker.generation && !this.marker.isMarked(entry)) {
        const record = this.heap.records[entry.h];
        if (record && this.heap.generations[entry.h] === entry.g && record.space !== 'frozen') {
          this.statistics.freedBytes += this.heap.reclaim(entry.h);
          this.statistics.freedObjects++;
        }
      }
      if (this.entryIndex >= block.entries.length) {
        this.blockIndex++;
        this.entryIndex = 0;
      }
    }
    this.statistics.maxSliceWork = Math.max(this.statistics.maxSliceWork, work);
    return { work, done: this.done };
  }

  snapshot() {
    return { blockIds: [...this.blockIds], blockIndex: this.blockIndex, entryIndex: this.entryIndex,
      statistics: { ...this.statistics } };
  }
}
