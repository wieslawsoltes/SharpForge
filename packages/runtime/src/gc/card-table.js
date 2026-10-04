/** A card indexes a bounded group of handle slots; entries retain identity stamps across slot reuse. */
export class CardTable {
  constructor(heap, { cardSize = 64 } = {}) {
    if (!Number.isSafeInteger(cardSize) || cardSize < 1 || cardSize > 4096) {
      throw new RangeError('Card size must be between 1 and 4096 handle slots');
    }
    this.heap = heap;
    this.cardSize = cardSize;
    this.cards = new Map();
    this.revisions = new Map();
    this.mutationSerial = 0;
    this.cardsScanned = 0;
    this.ownersScanned = 0;
    this.edgesScanned = 0;
    this.scanGeneration = 2;
    this.scanVisitor = null;
    this.scanOwnerGeneration = 2;
    this.scanHasYounger = false;
    this.visitScanEdge = value => {
      value = rootReference(value);
      const target = this.heap.tryGet(value);
      if (!target || target.gcGeneration >= this.scanOwnerGeneration) return;
      this.scanHasYounger = true;
      if (target.gcGeneration <= this.scanGeneration) this.scanVisitor(value);
    };
  }

  /** Record an old-to-young edge in constant time. Primitives and stale references are ignored. */
  remember(owner, value) {
    const source = this.heap.tryGet(owner);
    value = rootReference(value);
    const target = this.heap.tryGet(value);
    if (!source || !target || source.space === 'frozen' || source.gcGeneration <= target.gcGeneration) return false;
    return this.dirty(owner);
  }

  /** A bulk store dirties its owner once; precise edge filtering is deferred to remembered scanning. */
  dirty(owner) {
    const source = this.heap.tryGet(owner);
    if (!source || source.space === 'frozen' || source.gcGeneration === 0) return false;
    const index = Math.floor(owner.h / this.cardSize);
    let owners = this.cards.get(index);
    if (!owners) this.cards.set(index, owners = new Map());
    owners.set(owner.h, owner.g);
    this.revisions.set(owner.h, ++this.mutationSerial);
    return true;
  }

  forget(reference) {
    const index = Math.floor(reference.h / this.cardSize);
    const owners = this.cards.get(index);
    if (!owners || owners.get(reference.h) !== reference.g) return;
    owners.delete(reference.h);
    this.revisions.delete(reference.h);
    if (owners.size === 0) this.cards.delete(index);
  }

  /** Scan only remembered owners, retaining cards while any younger edge still exists. */
  scan(generation, visitor) {
    this.cardsScanned = 0;
    this.ownersScanned = 0;
    this.edgesScanned = 0;
    this.scanGeneration = generation;
    this.scanVisitor = visitor;
    for (const [index, owners] of this.cards) {
      this.cardsScanned++;
      for (const [handle, identity] of owners) {
        const record = this.heap.records[handle];
        if (!record || this.heap.generations[handle] !== identity || record.gcGeneration <= generation) continue;
        this.ownersScanned++;
        this.scanOwnerGeneration = record.gcGeneration;
        this.scanHasYounger = false;
        this.edgesScanned += this.heap.visitEdges(record, this.visitScanEdge);
        if (!this.scanHasYounger) owners.delete(handle);
      }
      if (owners.size === 0) this.cards.delete(index);
    }
    return { cardsScanned: this.cardsScanned, ownersScanned: this.ownersScanned, edgesScanned: this.edgesScanned };
  }

  /** Queue remembered owners without synchronously traversing a potentially very large reference array. */
  seed(generation, visitor) {
    this.cardsScanned = 0;
    this.ownersScanned = 0;
    this.edgesScanned = 0;
    for (const [index, owners] of this.cards) {
      this.cardsScanned++;
      for (const [handle, identity] of owners) {
        const record = this.heap.records[handle];
        if (!record || this.heap.generations[handle] !== identity) {
          owners.delete(handle);
        } else if (record.gcGeneration > generation) {
          this.ownersScanned++;
          visitor(this.heap.referenceAt(handle));
        }
      }
      if (owners.size === 0) this.cards.delete(index);
    }
    return this.statistics();
  }

  revision(reference) {
    return this.revisions.get(reference?.h) ?? 0;
  }

  ownerScanned(reference, hasYounger, revision) {
    if (!hasYounger && this.revision(reference) === revision) this.forget(reference);
  }

  statistics() {
    return { cardsScanned: this.cardsScanned, ownersScanned: this.ownersScanned, rememberedEdgesScanned: this.edgesScanned };
  }

  snapshot() {
    return { cardSize: this.cardSize, mutationSerial: this.mutationSerial, revisions: [...this.revisions], statistics: this.statistics(),
      cards: [...this.cards].map(([index, owners]) => ({ index, owners: [...owners] })) };
  }

  restore(state) {
    this.cards.clear();
    this.revisions.clear();
    if (!state) return;
    this.cardSize = state.cardSize;
    this.mutationSerial = state.mutationSerial;
    this.revisions = new Map(state.revisions);
    this.cardsScanned = state.statistics?.cardsScanned ?? 0;
    this.ownersScanned = state.statistics?.ownersScanned ?? 0;
    this.edgesScanned = state.statistics?.rememberedEdgesScanned ?? 0;
    for (const card of state.cards) this.cards.set(card.index, new Map(card.owners));
  }
}
import { rootReference } from './reference.js';
