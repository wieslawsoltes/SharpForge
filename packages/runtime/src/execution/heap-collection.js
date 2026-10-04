import {beginHeapCollection, endHeapCollection} from './heap-events.js';
import {forEachValueReference} from './value-references.js';

/** Existing non-moving mark/sweep policy, shared by standalone and VM heaps. */
export function collectHeap(heap, extraRoots, isReference) {
  beginHeapCollection(heap);
  heap.mutationRevision++;
  const start = performance.now();
  if (heap.marks.length < heap.records.length) {
    heap.marks = new Uint32Array(Math.max(heap.records.length, heap.marks.length * 2, 64));
  }
  if (++heap.markEpoch >= 0xffffffff) {
    heap.marks.fill(0);
    heap.markEpoch = 1;
  }
  const marked = heap.marks, epoch = heap.markEpoch, work = heap.markWork;
  work.length = 0;
  let rootsScanned = 0, edgesScanned = 0, markedObjects = 0;
  const add = value => {
    if (isReference(value) && heap.generations[value.h] === value.g && heap.records[value.h] && marked[value.h] !== epoch) {
      marked[value.h] = epoch;
      markedObjects++;
      work.push(value.h);
    }
  };
  const visit = value => {
    rootsScanned++;
    forEachValueReference(value, add);
  };
  const provided = heap.rootProvider(visit);
  if (provided !== undefined) for (const value of provided) visit(value);
  for (const value of heap.pins) visit(value);
  for (const value of extraRoots) visit(value);
  for (const handle of heap.handles.values()) if (!handle.weak) visit(handle.value);
  while (work.length) {
    const record = heap.records[work.pop()];
    if (record.kind !== 'string' && !ArrayBuffer.isView(record.data)) for (const value of record.data) {
      edgesScanned++;
      forEachValueReference(value, add);
    }
  }
  const markEnd = performance.now();
  let objects = 0, bytes = 0;
  for (let index = 0; index < heap.records.length; index++) {
    const record = heap.records[index];
    if (record && marked[index] !== epoch) {
      objects++;
      bytes += record.size;
      heap.records[index] = null;
      heap.free.push(index);
    }
  }
  for (const handle of heap.handles.values()) {
    if (handle.weak && isReference(handle.value) &&
        (heap.generations[handle.value.h] !== handle.value.g || !heap.records[handle.value.h])) handle.value = null;
  }
  const stats = heap.stats;
  stats.rootsScanned = rootsScanned;
  stats.edgesScanned = edgesScanned;
  stats.markedObjects = markedObjects;
  stats.markMs = markEnd - start;
  stats.sweepMs = performance.now() - markEnd;
  stats.liveBytes -= bytes;
  stats.liveObjects -= objects;
  stats.freedBytes += bytes;
  stats.freedObjects += objects;
  stats.collections++;
  stats.lastPauseMs = performance.now() - start;
  stats.totalPauseMs += stats.lastPauseMs;
  stats.maxPauseMs = Math.max(stats.maxPauseMs, stats.lastPauseMs);
  heap.threshold = Math.min(heap.maxBytes, Math.max(64 * 1024, stats.liveBytes * 2 + 1024));
  const result = {...stats, freedThisCollection: objects, bytesThisCollection: bytes};
  endHeapCollection(heap, result);
  return result;
}
