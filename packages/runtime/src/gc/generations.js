/** Collection generations are independent of the identity generation in a managed handle. */
export const GCGeneration = Object.freeze({ Nursery: 0, Ephemeral: 1, Mature: 2 });

/** Validate a condemned generation. Values outside the CLR range are rejected. */
export function validateGeneration(generation) {
  if (!Number.isInteger(generation) || generation < 0 || generation > 2) {
    throw new RangeError('Collection generation must be 0, 1 or 2');
  }
  return generation;
}

/** Initialize per-generation live accounting without replacing restored counters. */
export function initializeGenerations(heap) {
  heap.stats.generationCounts ??= [0, 0, 0];
  heap.stats.generationBytes ??= [0, 0, 0];
  heap.stats.generationCollections ??= [0, 0, 0];
}

/** Account a published allocation; large, pinned and frozen spaces enter generation two. */
export function generationAllocated(heap, record) {
  record.gcGeneration ??= record.space === 'small' || !record.space ? 0 : 2;
  record.age ??= 0;
  validateGeneration(record.gcGeneration);
  heap.stats.generationCounts[record.gcGeneration]++;
  heap.stats.generationBytes[record.gcGeneration] += record.size;
}

/** Move a surviving small-space object by exactly one generation. */
export function promoteSurvivor(heap, record) {
  const previous = record.gcGeneration;
  record.age++;
  if (previous >= 2 || record.space !== 'small') return previous;
  const next = previous + 1;
  heap.stats.generationCounts[previous]--;
  heap.stats.generationBytes[previous] -= record.size;
  heap.stats.generationCounts[next]++;
  heap.stats.generationBytes[next] += record.size;
  record.gcGeneration = next;
  return previous;
}

/** Update live accounting before a reclaimed handle can be reused. */
export function generationReleased(heap, record) {
  heap.stats.generationCounts[record.gcGeneration]--;
  heap.stats.generationBytes[record.gcGeneration] -= record.size;
}
