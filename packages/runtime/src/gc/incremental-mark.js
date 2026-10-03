export const MarkColor = Object.freeze({ White: 0, Grey: 1, Black: 2 });

/** Precise tri-color marker. A slice charges one unit per object start and reference-capable slot examined. */
export class IncrementalMarker {
  constructor(heap, blocks, cards = null) {
    this.heap = heap;
    this.blocks = blocks;
    this.cards = cards;
    this.epoch = 0;
    this.generation = 2;
    this.epochs = new Uint32Array(0);
    this.identities = new Float64Array(0);
    this.colors = new Uint8Array(0);
    this.markGenerations = new Uint8Array(0);
    this.work = [];
    this.survivors = [];
    this.cursor = null;
    this.cursorStorage = { handle: -1, identity: 0, next: 0, remembered: false,
      ownerGeneration: 0, hasYounger: false, cardRevision: 0 };
    this.remembered = new Set();
    this.cutoff = 0;
    this.edgeResult = { next: 0, done: false, examined: 0 };
    this.statistics = {};
    this.visit = value => this.mark(value);
    this.barrierVisit = value => {
      if (this.mark(value)) this.statistics.barrierMarks++;
    };
    this.rememberedVisit = value => this.queueRemembered(value);
    this.scanVisit = value => {
      value = rootReference(value);
      if (this.cursor.remembered) {
        const target = this.heap.tryGet(value);
        if (target && target.gcGeneration < this.cursor.ownerGeneration) this.cursor.hasYounger = true;
      }
      this.mark(value);
    };
    this.rootVisit = (value, category = 'unknown') => {
      this.statistics.rootsScanned++;
      const counts = this.statistics.rootsScannedByCategory;
      counts[category] = (counts[category] ?? 0) + 1;
      this.mark(value);
    };
  }

  ensureCapacity(length) {
    if (length <= this.epochs.length) return;
    const capacity = Math.max(64, length, this.epochs.length * 2);
    const epochs = new Uint32Array(capacity);
    const identities = new Float64Array(capacity);
    const colors = new Uint8Array(capacity);
    const markGenerations = new Uint8Array(capacity);
    epochs.set(this.epochs);
    identities.set(this.identities);
    colors.set(this.colors);
    markGenerations.set(this.markGenerations);
    this.epochs = epochs;
    this.identities = identities;
    this.colors = colors;
    this.markGenerations = markGenerations;
  }

  begin(generation) {
    this.ensureCapacity(this.heap.records.length);
    if (++this.epoch >= 0xffffffff) {
      this.epochs.fill(0);
      this.epoch = 1;
      for (const block of this.blocks.blocks.values()) {
        block.epoch = 0;
        for (const entry of block.entries) if (entry) entry.markedEpoch = 0;
      }
    }
    this.generation = generation;
    this.cutoff = this.heap.generationCounter;
    this.work.length = 0;
    this.survivors.length = 0;
    this.cursor = null;
    this.remembered.clear();
    this.statistics = { rootsScanned: 0, edgesScanned: 0, markedObjects: 0, scannedObjects: 0,
      barrierMarks: 0, allocatedBlack: 0, maxSliceWork: 0, markedBytesByGeneration: [0, 0, 0],
      rootsScannedByCategory: Object.create(null) };
    this.blocks.begin(this.epoch, generation);
    this.heap.lifetime?.beginMark?.();
  }

  isMarked(value) {
    const record = this.heap.tryGet(value);
    if (!record) return false;
    if (record.space === 'frozen' || record.gcGeneration > this.generation) return true;
    return this.epochs[value.h] === this.epoch && this.identities[value.h] === value.g;
  }

  color(value) {
    const record = this.heap.tryGet(value);
    if (!record) return MarkColor.White;
    if (record.space === 'frozen' || record.gcGeneration > this.generation) return MarkColor.Black;
    return this.isMarked(value) ? this.colors[value.h] : MarkColor.White;
  }

  mark(value) {
    value = rootReference(value);
    if (!value) return false;
    const record = this.heap.records[value.h];
    if (!record || this.heap.generations[value.h] !== value.g
      || record.space === 'frozen' || record.gcGeneration > this.generation) return false;
    if (this.epochs[value.h] === this.epoch && this.identities[value.h] === value.g) return false;
    this.ensureCapacity(value.h + 1);
    this.epochs[value.h] = this.epoch;
    this.identities[value.h] = value.g;
    const edges = record.descriptor.scan !== 'none'
      && (record.storage?.length ?? record.data.length) !== 0;
    this.colors[value.h] = edges ? MarkColor.Grey : MarkColor.Black;
    this.markGenerations[value.h] = record.gcGeneration;
    if (edges) this.work.push(value.h);
    else this.statistics.scannedObjects++;
    if (record.gcGeneration < 2 && record.space === 'small' && record.allocationId <= this.cutoff) this.survivors.push(value.h);
    this.statistics.markedObjects++;
    if (record.allocationId <= this.cutoff) this.statistics.markedBytesByGeneration[record.gcGeneration] += record.size;
    this.blocks.mark(value);
    this.heap.lifetime?.noteMarked?.(value);
    return true;
  }

  resized(reference, previousSize) {
    const record = this.heap.get(reference);
    const marked = this.epochs[reference.h] === this.epoch && this.identities[reference.h] === reference.g;
    let source = -1;
    if (marked && record.allocationId <= this.cutoff) {
      source = this.markGenerations[reference.h];
      this.statistics.markedBytesByGeneration[source] += record.size - previousSize;
    }
    if (this.cursor?.handle === reference.h) this.cursor.next = 0;
    return source;
  }

  queueRemembered(reference) {
    const record = this.heap.tryGet(reference);
    if (!record || record.gcGeneration <= this.generation || this.remembered.has(reference.h)) return;
    this.ensureCapacity(reference.h + 1);
    this.identities[reference.h] = reference.g;
    this.work.push(reference.h);
    this.remembered.add(reference.h);
  }

  /** Allocations are black; their initialized edges are shaded before publication can complete. */
  allocatedBlack(reference) {
    const record = this.heap.get(reference);
    if (record.space === 'frozen') return;
    this.ensureCapacity(reference.h + 1);
    this.epochs[reference.h] = this.epoch;
    this.identities[reference.h] = reference.g;
    this.colors[reference.h] = MarkColor.Black;
    this.markGenerations[reference.h] = record.gcGeneration;
    this.blocks.mark(reference);
    this.statistics.allocatedBlack++;
    this.heap.lifetime?.noteMarked?.(reference);
    this.statistics.edgesScanned += this.heap.visitEdges(record, this.visit);
  }

  /** Dijkstra insertion barrier also shades from partially scanned grey owners. */
  insertionBarrier(owner, value) {
    if (this.isMarked(owner) && this.mark(value)) this.statistics.barrierMarks++;
  }

  roots(extraRoots) {
    this.heap.visitRoots(this.rootVisit, extraRoots);
  }

  get pending() {
    return this.cursor !== null || this.work.length !== 0;
  }

  step(budget) {
    let work = 0;
    while (work < budget && this.pending) {
      if (!this.cursor) {
        const handle = this.work.pop();
        this.cursor = this.cursorStorage;
        this.cursor.handle = handle;
        this.cursor.identity = this.identities[handle];
        this.cursor.next = 0;
        this.cursor.remembered = this.generation < 2 && this.remembered.has(handle);
        this.cursor.ownerGeneration = this.heap.records[handle]?.gcGeneration ?? 0;
        this.cursor.hasYounger = false;
        this.cursor.cardRevision = this.cursor.remembered ? this.cards?.revision(this.blocks.slots[handle]) ?? 0 : 0;
        this.statistics.scannedObjects++;
        work++;
        if (work === budget) break;
      }
      const cursor = this.cursor;
      const record = this.heap.records[cursor.handle];
      if (!record || this.heap.generations[cursor.handle] !== cursor.identity) {
        this.cursor = null;
        continue;
      }
      const visitor = cursor.remembered ? this.scanVisit : this.visit;
      const result = this.heap.visitEdgeRange(record, cursor.next, budget - work, visitor, this.edgeResult);
      cursor.next = result.next;
      work += result.examined;
      this.statistics.edgesScanned += result.examined;
      if (cursor.remembered && this.cards) this.cards.edgesScanned += result.examined;
      if (result.done) {
        this.colors[cursor.handle] = MarkColor.Black;
        if (cursor.remembered && this.cards) {
          this.cards.ownerScanned(this.blocks.slots[cursor.handle], cursor.hasYounger, cursor.cardRevision);
        }
        this.cursor = null;
      } else if (result.examined === 0) {
        throw new Error('GC edge cursor made no progress within a positive work budget');
      }
    }
    this.statistics.maxSliceWork = Math.max(this.statistics.maxSliceWork, work);
    return { work, done: !this.pending };
  }

  /** Atomic termination is bounded by the finite managed heap, with no mutator interleaving. */
  drain() {
    let work = 0;
    while (this.pending) work += this.step(65536).work;
    return work;
  }

  snapshot() {
    return { epoch: this.epoch, generation: this.generation, cutoff: this.cutoff,
      epochs: [...this.epochs], identities: [...this.identities],
      colors: [...this.colors], markGenerations: [...this.markGenerations], work: [...this.work], survivors: [...this.survivors],
      remembered: [...this.remembered], cursor: this.cursor ? { ...this.cursor } : null,
      statistics: { ...this.statistics, markedBytesByGeneration: [...(this.statistics.markedBytesByGeneration ?? [0, 0, 0])],
        rootsScannedByCategory: { ...this.statistics.rootsScannedByCategory } } };
  }

  restore(state) {
    if (!state) {
      this.epoch = 0;
      this.epochs.fill(0);
      this.work.length = 0;
      this.survivors.length = 0;
      this.cursor = null;
      this.remembered.clear();
      return;
    }
    this.epoch = state.epoch;
    this.generation = state.generation;
    this.cutoff = state.cutoff;
    this.epochs = Uint32Array.from(state.epochs);
    this.identities = Float64Array.from(state.identities);
    this.colors = Uint8Array.from(state.colors);
    this.markGenerations = Uint8Array.from(state.markGenerations);
    this.work = [...state.work];
    this.survivors = [...state.survivors];
    this.remembered = new Set(state.remembered);
    this.cursor = state.cursor ? Object.assign(this.cursorStorage, state.cursor) : null;
    this.statistics = { ...state.statistics, markedBytesByGeneration: [...state.statistics.markedBytesByGeneration],
      rootsScannedByCategory: Object.assign(Object.create(null), state.statistics.rootsScannedByCategory) };
  }
}
import { rootReference } from './reference.js';
