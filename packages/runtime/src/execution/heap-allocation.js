import {emitHeapAllocation} from './heap-events.js';

/** Existing managed-byte accounting; optional instrumentation receives only committed scalar sizes. */
export function recordAllocation(heap, size) {
  heap.mutationRevision++;
  heap.stats.allocatedBytes += size;
  heap.stats.liveBytes += size;
  heap.stats.liveObjects++;
  heap.stats.allocations++;
  heap.stats.peakBytes = Math.max(heap.stats.peakBytes, heap.stats.liveBytes);
  emitHeapAllocation(heap, size);
  heap.allocationObserver?.allocation(size);
}

/** Replace owned array-backed storage; successful growth counts bytes, never another object allocation. */
export function replaceHeapData(heap, reference, data) {
  const record = heap.get(reference);
  if (!Array.isArray(data) || record.kind === 'string') throw new TypeError('Array-backed record required');
  const next = 32 + data.length * 8, delta = next - record.size;
  if (delta > 0) heap.reserve(delta, [reference, ...data]);
  heap.stats.liveBytes += delta;
  heap.stats.allocatedBytes += Math.max(0, delta);
  heap.stats.peakBytes = Math.max(heap.stats.peakBytes, heap.stats.liveBytes);
  record.data = [...data];
  record.size = next;
  heap.mutationRevision++;
  if (delta > 0) {
    emitHeapAllocation(heap, delta, true);
    heap.allocationObserver?.allocation(delta, true);
  }
}
