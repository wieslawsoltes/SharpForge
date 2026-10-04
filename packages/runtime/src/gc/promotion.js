import { promoteSurvivor } from './generations.js';
import {rootReference} from './reference.js';

/** Promotion and remembered-set repair use the same bounded edge cursor as marking. */
export class SurvivorPromotion {
  constructor(heap, { blocks, cards, marker, budgets, cutoff, enabled = true, state = null }) {
    this.heap = heap;
    this.blocks = blocks;
    this.cards = cards;
    this.marker = marker;
    this.budgets = budgets;
    this.cutoff = cutoff;
    this.enabled = enabled;
    this.index = state?.index ?? 0;
    this.cursorStorage = { handle: -1, identity: 0, next: 0, generation: 0, hasYounger: false };
    this.cursor = state?.cursor ? Object.assign(this.cursorStorage, state.cursor) : null;
    this.promotedObjects = state?.promotedObjects ?? 0;
    this.promotedBytes = state?.promotedBytes ?? 0;
    this.owner = null;
    this.edgeResult = { next: 0, done: false, examined: 0 };
    this.visit = value => {
      if (this.cursor.hasYounger) return;
      const target = this.heap.tryGet(rootReference(value));
      if (target && target.gcGeneration < this.cursor.generation) {
        this.cursor.hasYounger = true;
        this.cards.dirty(this.owner);
      }
    };
  }

  get done() {
    return !this.enabled || (this.cursor === null && this.index >= this.marker.survivors.length);
  }

  step(budget) {
    let work = 0;
    while (work < budget && !this.done) {
      if (!this.cursor) {
        const handle = this.marker.survivors[this.index++];
        const record = this.heap.records[handle];
        work++;
        if (!record || record.allocationId > this.cutoff || record.gcGeneration >= 2 || record.space !== 'small') continue;
        const reference = this.blocks.slots[handle];
        const previous = promoteSurvivor(this.heap, record);
        this.blocks.promoted(reference, previous);
        this.budgets.promoted(record, previous);
        this.promotedObjects++;
        this.promotedBytes += record.size;
        if (record.descriptor.scan === 'none' || (record.storage?.length ?? record.data.length) === 0) continue;
        this.cursor = this.cursorStorage;
        this.cursor.handle = handle;
        this.cursor.identity = this.heap.generations[handle];
        this.cursor.next = 0;
        this.cursor.generation = record.gcGeneration;
        this.cursor.hasYounger = false;
        if (work === budget) break;
      }
      const cursor = this.cursor;
      const record = this.heap.records[cursor.handle];
      this.owner = this.blocks.slots[cursor.handle];
      const result = this.heap.visitEdgeRange(record, cursor.next, budget - work, this.visit, this.edgeResult);
      work += result.examined;
      cursor.next = result.next;
      if (result.done) this.cursor = null;
      else if (result.examined === 0) throw new Error('GC promotion edge cursor made no progress');
    }
    this.owner = null;
    return { work, done: this.done };
  }

  snapshot() {
    return { index: this.index, cursor: this.cursor ? { ...this.cursor } : null,
      promotedObjects: this.promotedObjects, promotedBytes: this.promotedBytes };
  }
}
