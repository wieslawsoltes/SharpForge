/** Number-valued compatibility counters; exact allocation bytes live on the heap. */
export function createStats(heap, restored = {}) {
  const stats = {
    allocatedBytes: 0,
    hostStrongHandles: 0,
    hostWeakHandles: 0,
    rootsScanned: 0,
    edgesScanned: 0,
    markedObjects: 0,
    maxPauseMs: 0,
    markMs: 0,
    sweepMs: 0,
    liveBytes: 0,
    liveObjects: 0,
    allocations: 0,
    collections: 0,
    freedObjects: 0,
    freedBytes: 0,
    lastPauseMs: 0,
    totalPauseMs: 0,
    peakBytes: 0,
    generationCounts: [0, 0, 0],
    generationBytes: [0, 0, 0],
    generationCollections: [0, 0, 0],
    ...restored
  };
  for (const name of ['generationCounts', 'generationBytes', 'generationCollections']) {
    stats[name] = [...stats[name]];
  }
  Object.defineProperty(stats, 'allocatedBytes64', {get: () => heap.allocatedBytes64});
  return stats;
}

export function accountAllocation(heap, bytes, objects = 1) {
  const stats = heap.stats;
  stats.allocatedBytes += bytes;
  heap.allocatedBytes64 += BigInt(bytes);
  stats.liveBytes += bytes;
  stats.liveObjects += objects;
  stats.allocations += objects;
  stats.peakBytes = Math.max(stats.peakBytes, stats.liveBytes);
}
