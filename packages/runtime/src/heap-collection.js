import {isReference} from './heap-reference.js';

const observers = new WeakMap();

/** Run weak-state cleanup after sweep, never while the root or object graph is being scanned. */
export function observeHeapCollections(heap, callback) {
  let listeners = observers.get(heap);
  if (!listeners) { listeners = new Set(); observers.set(heap, listeners); }
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function mark(heap, extraRoots) {
  if (heap.marks.length < heap.records.length) {
    heap.marks = new Uint32Array(Math.max(heap.records.length, heap.marks.length * 2, 64));
  }
  if (++heap.markEpoch >= 0xffffffff) { heap.marks.fill(0); heap.markEpoch = 1; }
  const {marks, markEpoch, markWork: work} = heap;
  work.length = 0;
  let rootsScanned = 0, edgesScanned = 0, markedObjects = 0;
  const add = value => {
    if (!isReference(value) || heap.generations[value.h] !== value.g || !heap.records[value.h] || marks[value.h] === markEpoch) return;
    marks[value.h] = markEpoch;
    markedObjects++;
    work.push(value.h);
  };
  const visit = value => { rootsScanned++; add(value); };
  const provided = heap.rootProvider(visit);
  if (provided !== undefined) for (const value of provided) visit(value);
  for (const value of heap.pins) visit(value);
  for (const value of extraRoots) visit(value);
  for (const handle of heap.handles.values()) if (!handle.weak) visit(handle.value);
  while (work.length) {
    const record = heap.records[work.pop()];
    if (record.kind !== 'string') for (const value of record.data) { edgesScanned++; add(value); }
  }
  Object.assign(heap.stats, {rootsScanned, edgesScanned, markedObjects});
}

function sweep(heap) {
  let objects = 0, bytes = 0;
  for (let h = 0; h < heap.records.length; h++) {
    const record = heap.records[h];
    if (!record || heap.marks[h] === heap.markEpoch) continue;
    objects++;
    bytes += record.size;
    heap.records[h] = null;
    heap.free.push(h);
  }
  for (const handle of heap.handles.values()) {
    const ref = handle.value;
    if (handle.weak && isReference(ref) && (heap.generations[ref.h] !== ref.g || !heap.records[ref.h])) handle.value = null;
  }
  return {objects, bytes};
}

/** The collector preserves exact generation-checked roots and accounts native cleanup after collection. */
export function collectHeap(heap, extraRoots = []) {
  heap.mutationRevision++;
  const start = performance.now();
  mark(heap, extraRoots);
  const markEnd = performance.now();
  const {objects, bytes} = sweep(heap);
  const stats = heap.stats;
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
  for (const callback of [...(observers.get(heap) ?? [])]) callback();
  return {...stats, freedThisCollection: objects, bytesThisCollection: bytes};
}
