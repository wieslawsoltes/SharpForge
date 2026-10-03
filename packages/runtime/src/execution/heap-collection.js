import {forEachValueReference} from './value-references.js';
import {isReference} from './managed-fault.js';

/** Trace generation-checked handles and sweep unreachable records without moving them. */
export function collectHeap(heap, extraRoots = []) {
  heap.mutationRevision++;
  const start = performance.now();
  if (heap.observer) heap.observer.gcStart(heap.stats);
  if (heap.marks.length < heap.records.length) {
    heap.marks = new Uint32Array(Math.max(heap.records.length, heap.marks.length * 2, 64));
  }
  if (++heap.markEpoch >= 0xffffffff) {
    heap.marks.fill(0);
    heap.markEpoch = 1;
  }
  const marked = heap.marks;
  const epoch = heap.markEpoch;
  const work = heap.markWork;
  work.length = 0;
  const metrics = {rootsScanned: 0, edgesScanned: 0, markedObjects: 0};
  const mark = value => {
    const owned = value.heapOwner === undefined || value.heapOwner === heap.handleOwner;
    if (!owned || heap.generations[value.h] !== value.g || !heap.records[value.h] || marked[value.h] === epoch) return;
    marked[value.h] = epoch;
    metrics.markedObjects++;
    work.push(value.h);
  };
  const add = value => forEachValueReference(value, mark);
  const root = value => { metrics.rootsScanned++; add(value); };
  // Providers may visit roots directly. Existing iterable providers still work,
  // including standalone ManagedHeap users and diagnostic tooling.
  const provided = heap.rootProvider(root);
  for (const roots of [provided ?? [], heap.pins, extraRoots]) {
    for (const value of roots) {
      metrics.rootsScanned++;
      add(value);
    }
  }
  for (const handle of heap.handles.values()) {
    if (!handle.weak) {
      metrics.rootsScanned++;
      add(handle.value);
    }
  }
  while (work.length) {
    const record = heap.records[work.pop()];
    if (record.kind === 'string') continue;
    for (const value of record.data) {
      metrics.edgesScanned++;
      add(value);
    }
  }
  const markEnd = performance.now();
  let objects = 0;
  let bytes = 0;
  for (let index = 0; index < heap.records.length; index++) {
    const record = heap.records[index];
    if (!record || marked[index] === epoch) continue;
    objects++;
    bytes += record.size;
    heap.records[index] = null;
    heap.free.push(index);
    heap.snapshotRecords.delete(index);
  }
  for (const handle of heap.handles.values()) {
    const value = handle.value;
    if (handle.weak && isReference(value) && (heap.generations[value.h] !== value.g || !heap.records[value.h])) {
      handle.value = null;
    }
  }
  const result = finishCollection(heap, {start, markEnd, objects, bytes, ...metrics});
  if (heap.observer) heap.observer.gcEnd(result);
  return result;
}

function finishCollection(heap, metrics) {
  const stats = heap.stats;
  stats.rootsScanned = metrics.rootsScanned;
  stats.edgesScanned = metrics.edgesScanned;
  stats.markedObjects = metrics.markedObjects;
  stats.markMs = metrics.markEnd - metrics.start;
  stats.sweepMs = performance.now() - metrics.markEnd;
  stats.liveBytes -= metrics.bytes;
  stats.liveObjects -= metrics.objects;
  stats.freedBytes += metrics.bytes;
  stats.freedObjects += metrics.objects;
  stats.collections++;
  stats.lastPauseMs = performance.now() - metrics.start;
  stats.totalPauseMs += stats.lastPauseMs;
  stats.maxPauseMs = Math.max(stats.maxPauseMs, stats.lastPauseMs);
  heap.threshold = Math.min(heap.maxBytes, Math.max(64 * 1024, stats.liveBytes * 2 + 1024));
  return {...stats, freedThisCollection: metrics.objects, bytesThisCollection: metrics.bytes};
}
