function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

/** Compute the next byte threshold, retaining the caller's initial floor after every collection. */
export function nextCollectionThreshold({ initialThreshold, maxBytes, liveBytes, growthFactor = 2 }) {
  positiveInteger(initialThreshold, 'initialThreshold');
  positiveInteger(maxBytes, 'maxBytes');
  if (!Number.isFinite(growthFactor) || growthFactor < 1 || !Number.isSafeInteger(liveBytes) || liveBytes < 0) {
    throw new RangeError('Invalid collection threshold policy');
  }
  return Math.min(maxBytes, Math.max(initialThreshold, Math.ceil(liveBytes * growthFactor)));
}

/** Per-generation allocation budgets use live-byte limits and bounded survival feedback. */
export class GenerationBudget {
  constructor(heap, options = {}) {
    this.heap = heap;
    this.initialThreshold = heap.initialThreshold ?? options.initialThreshold ?? heap.threshold;
    this.growthFactor = options.thresholdGrowthFactor ?? 2;
    nextCollectionThreshold({ initialThreshold: this.initialThreshold, maxBytes: heap.maxBytes, liveBytes: 0,
      growthFactor: this.growthFactor });
    this.thresholdPolicy = options.thresholdPolicy ?? nextCollectionThreshold;
    if (typeof this.thresholdPolicy !== 'function') throw new TypeError('thresholdPolicy must be a function');
    const nursery = options.nurseryBytes ?? options.gen0Budget ?? options.GCgen0size ?? this.initialThreshold;
    this.minimum = Math.min(heap.maxBytes,
      positiveInteger(options.minNurseryBytes ?? Math.max(1, Math.floor(nursery / 4)), 'minNurseryBytes'));
    this.maximum = Math.min(heap.maxBytes, positiveInteger(options.maxNurseryBytes ?? heap.maxBytes, 'maxNurseryBytes'));
    if (this.minimum > this.maximum) throw new RangeError('Nursery minimum exceeds maximum');
    this.initial = [nursery, options.gen1Budget ?? Math.min(heap.maxBytes, nursery * 4),
      options.gen2Budget ?? Math.min(heap.maxBytes, nursery * 16)].map(
      (value, index) => Math.min(heap.maxBytes, positiveInteger(value, `generation ${index} budget`))
    );
    this.budgets = [...this.initial];
    this.budgets[0] = Math.max(this.minimum, Math.min(this.maximum, this.budgets[0]));
    this.allocated = [0, 0, 0];
    this.survival = [0, 0, 0];
    this.promotionLimits = [0, options.gen1PromotionLimit ?? heap.maxBytes, options.gen2PromotionLimit ?? heap.maxBytes];
    positiveInteger(this.promotionLimits[1], 'gen1PromotionLimit');
    positiveInteger(this.promotionLimits[2], 'gen2PromotionLimit');
  }

  allocatedBytes(record, bytes = record.size) {
    this.allocated[record.gcGeneration] += bytes;
  }

  promoted(record, previousGeneration) {
    if (record.gcGeneration !== previousGeneration) this.allocated[record.gcGeneration] += record.size;
  }

  /** Select the least expensive eligible collection; null means the budgets have headroom. */
  generationForAllocation(bytes) {
    const live = this.heap.stats.generationBytes;
    if (this.heap.stats.liveBytes + bytes > this.heap.maxBytes) return 2;
    if (this.allocated[2] >= this.budgets[2]) return 2;
    if (this.allocated[0] + bytes < this.budgets[0]) return null;
    if (live[1] >= this.budgets[1] || this.allocated[1] >= this.budgets[1]) return 1;
    return 0;
  }

  /** Promotion pressure escalates before weak processing, never after partial reclamation. */
  promotionOverflows(generation, survivingBytes) {
    if (generation >= 2) return false;
    for (let source = 0; source <= generation; source++) {
      const target = source + 1;
      const retained = target <= generation ? 0 : this.heap.stats.generationBytes[target];
      if (retained + survivingBytes[source] > this.promotionLimits[target]) return true;
    }
    return false;
  }

  collectionCompleted(generation, beforeBytes, survivingBytes) {
    for (let index = 0; index <= generation; index++) {
      this.allocated[index] = 0;
      this.survival[index] = beforeBytes[index] === 0 ? 0 : survivingBytes[index] / beforeBytes[index];
    }
    const ratio = this.survival[0];
    const factor = ratio < 0.2 ? 1.25 : ratio > 0.7 ? 0.75 : 1;
    this.budgets[0] = Math.max(this.minimum, Math.min(this.maximum, Math.round(this.budgets[0] * factor)));
    // An uncollected generation keeps its target until it is collected. Moving that target on each
    // minor collection lets surviving promotions increase the target faster than allocation pressure.
    for (let index = 1; index <= generation; index++) {
      this.budgets[index] = Math.min(this.heap.maxBytes, Math.max(this.initial[index], this.heap.stats.generationBytes[index] * 2));
    }
    const next = this.thresholdPolicy({ initialThreshold: this.initialThreshold, maxBytes: this.heap.maxBytes,
      liveBytes: this.heap.stats.liveBytes, growthFactor: this.growthFactor, generation, survival: [...this.survival] });
    if (!Number.isSafeInteger(next) || next < 1 || next > this.heap.maxBytes) {
      throw new RangeError('Collection threshold policy returned an invalid byte budget');
    }
    this.heap.threshold = next;
  }

  snapshot() {
    return { budgets: [...this.budgets], allocated: [...this.allocated], survival: [...this.survival] };
  }

  restore(state) {
    if (!state) return;
    this.budgets = [...state.budgets];
    this.allocated = [...state.allocated];
    this.survival = [...state.survival];
  }
}
