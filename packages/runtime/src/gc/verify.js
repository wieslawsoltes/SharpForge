import {isReference, rootReference} from './reference.js';
import {recordSize} from './sizing.js';

/** Bounded invariant checker; diagnostic work never mutates collector state. */
export function verifyHeap(heap, {maxObjects = 1_000_000, maxEdges = 10_000_000, throwOnError = true} = {}) {
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1 || !Number.isSafeInteger(maxEdges) || maxEdges < 1) {
    throw new RangeError('Invalid heap verification budget');
  }
  const errors = [];
  const free = new Set();
  let bytes = 0;
  let objects = 0;
  let edges = 0;
  let truncated = false;
  const report = (code, detail) => {
    if (errors.length < 100) errors.push({code, ...detail});
  };
  for (const handle of heap.free) {
    if (free.has(handle)) report('GC_VERIFY_DUPLICATE_FREE', {handle});
    if (!Number.isInteger(handle) || handle < 0 || handle >= heap.records.length || heap.records[handle]) {
      report('GC_VERIFY_FREE_SLOT', {handle});
    }
    free.add(handle);
  }
  for (let handle = 0; handle < heap.records.length; handle++) {
    const record = heap.records[handle];
    if (!record) continue;
    if (++objects > maxObjects) { truncated = true; break; }
    bytes += record.size;
    if (!Number.isSafeInteger(heap.generations[handle]) || heap.generations[handle] < 1) {
      report('GC_VERIFY_IDENTITY', {handle});
    }
    if (!record.descriptor || recordSize(record.descriptor, record.data.length) !== record.size) {
      report('GC_VERIFY_LAYOUT', {handle});
    }
    if (!Number.isInteger(record.gcGeneration) || record.gcGeneration < 0 || record.gcGeneration > 2) {
      report('GC_VERIFY_GENERATION', {handle});
    }
    let cursor = 0;
    let done = false;
    while (!done && edges < maxEdges) {
      const result = heap.visitEdgeRange(record, cursor, Math.min(256, maxEdges - edges), value => {
        const reference = rootReference(value);
        if (reference && !heap.tryGet(reference)) report('GC_VERIFY_DANGLING_EDGE', {handle, reference});
        const target = reference && heap.tryGet(reference);
        if (target && record.gcGeneration > target.gcGeneration && record.space !== 'frozen') {
          const cards = heap.collector.cards;
          const card = cards.cards.get(Math.floor(handle / cards.cardSize));
          if (card?.get(handle) !== heap.generations[handle]) report('GC_VERIFY_MISSING_CARD', {handle, reference});
        }
        if (target && heap.collector.active) {
          const marker = heap.collector.marker;
          const owner = heap.referenceAt(handle);
          if (marker.color(owner) === 2 && marker.color(reference) === 0) {
            report('GC_VERIFY_TRICOLOR', {handle, reference});
          }
        }
      });
      edges += result.examined;
      cursor = result.next;
      done = result.done;
    }
    if (!done) { truncated = true; break; }
  }
  heap.visitRoots((value, category) => {
    if (isReference(value) && !heap.tryGet(value)) report('GC_VERIFY_DANGLING_ROOT', {category, reference: value});
    if (isReference(value) && heap.tryGet(value) && heap.collector.active && heap.collector.marker.color(value) === 0) {
      report('GC_VERIFY_UNMARKED_ROOT', {category, reference: value});
    }
  });
  if (!truncated && (bytes !== heap.stats.liveBytes || objects !== heap.stats.liveObjects)) {
    report('GC_VERIFY_ACCOUNTING', {bytes, objects, reportedBytes: heap.stats.liveBytes, reportedObjects: heap.stats.liveObjects});
  }
  const result = {valid: !truncated && errors.length === 0, errors, truncated, objects, bytes, edges};
  if (throwOnError && !result.valid) {
    const error = new Error(truncated ? 'Heap verification budget exhausted' : `Heap invariant failed: ${errors[0].code}`);
    error.name = 'HeapVerificationError';
    error.report = result;
    throw error;
  }
  return result;
}
