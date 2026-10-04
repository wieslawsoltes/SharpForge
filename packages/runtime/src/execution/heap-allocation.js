import {emitHeapAllocation} from './heap-events.js';
import {isArrayStorage, arrayStorageBytes, cloneArrayStorage, primitiveArrayConstructor, normalizeArrayStorage} from './array-storage.js';
import {createHeapReference} from './heap-reference.js';

function notifyAllocation(heap, reference, size, growth = false) {
  const pinStart = heap.pins.length;
  heap.pins.push(reference);
  try {
    emitHeapAllocation(heap, size, growth);
    if (growth) heap.allocationObserver?.allocation(size, true);
    else heap.allocationObserver?.allocation(size);
  } finally {
    heap.pins.length = pinStart;
  }
}

/** Account committed managed bytes and issue a reference that survives synchronous observer collection. */
export function recordAllocation(heap, size, handle, generation) {
  const reference = createHeapReference(heap, handle, generation);
  heap.mutationRevision++;
  heap.stats.allocatedBytes += size;
  heap.stats.liveBytes += size;
  heap.stats.liveObjects++;
  heap.stats.allocations++;
  heap.stats.peakBytes = Math.max(heap.stats.peakBytes, heap.stats.liveBytes);
  notifyAllocation(heap, reference, size);
  return reference;
}

/** Replace owned array-backed storage; successful growth counts bytes, never another object allocation. */
export function replaceHeapData(heap, reference, data) {
  const record = heap.get(reference);
  if (!isArrayStorage(data) || record.kind === 'string') throw new TypeError('Array-backed record required');
  const element = record.kind === 'array' ? record.methodTable.elementType : null;
  const constructor = element && primitiveArrayConstructor(element);
  const next = 32 + (constructor ? data.length * constructor.BYTES_PER_ELEMENT : arrayStorageBytes(data));
  const delta = next - record.size;
  if (delta > 0) heap.reserve(delta, (function* () { yield reference; if (!ArrayBuffer.isView(data)) yield* data; })());
  const replacement = element ? normalizeArrayStorage(element, data, true) : cloneArrayStorage(data);
  heap.stats.liveBytes += delta;
  heap.stats.allocatedBytes += Math.max(0, delta);
  heap.stats.peakBytes = Math.max(heap.stats.peakBytes, heap.stats.liveBytes);
  record.data = replacement;
  record.size = next;
  heap.mutationRevision++;
  if (delta > 0) notifyAllocation(heap, reference, delta, true);
}
