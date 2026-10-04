import assert from 'node:assert/strict';
import { ManagedHeap } from '@sharpforge/runtime';

export function collectorHeap(options = {}) {
  return new ManagedHeap({ maxBytes: 4 * 1024 * 1024, initialThreshold: 2 * 1024 * 1024, ...options });
}

export function finishCollection(heap, budget = 7) {
  let slices = 0;
  while (heap.collector.active) {
    const status = heap.collector.step(budget);
    assert(status.work <= budget, `Slice charged ${status.work} operations to budget ${budget}`);
    if (++slices > 1000000) throw new Error('Collector failed to make bounded progress');
  }
  return heap.collector.lastResult;
}

export function reachableReferences(heap, roots) {
  const found = new Map();
  const queue = [...roots];
  while (queue.length) {
    const reference = queue.pop();
    const record = heap.tryGet(reference);
    if (!record || found.has(reference.h)) continue;
    found.set(reference.h, reference);
    heap.visitEdges(record, value => queue.push(value));
  }
  return [...found.values()];
}

export function assertRetained(heap, references) {
  for (const reference of references) assert(heap.tryGet(reference), `Lost reachable object ${reference.h}:${reference.g}`);
}

export function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}
