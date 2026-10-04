import assert from 'node:assert/strict';

export function collectLifetime(heap, mode = 'blocking', roots = [], options = {}) {
  if (mode === 'blocking') return heap.collect(roots, options);
  heap.collector.startIncremental({...options, extraRoots: roots});
  let slices = 0;
  while (heap.collector.active) {
    heap.collector.step(7);
    assert.ok(++slices < 100000, 'Incremental collection must terminate within the fixture bound');
  }
  return heap.collector.lastResult;
}

export function live(heap, reference) {
  return heap.generations[reference.h] === reference.g && heap.records[reference.h] !== null;
}
