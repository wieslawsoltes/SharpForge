import test from 'node:test';
import assert from 'node:assert/strict';
import { collectorHeap, finishCollection } from './a06-collector-fixtures.js';

test('A06 blocks: an entirely live heap has no sweep candidate blocks or handle-slot visits', () => {
  const heap = collectorHeap();
  const roots = [];
  heap.rootProvider = () => roots;
  for (let index = 0; index < 10000; index++) roots.push(heap.object('Live', []));
  const result = heap.collect();
  assert.equal(result.freedThisCollection, 0);
  assert.equal(result.sweepBlocks, 0);
  assert.equal(result.sweepSlots, 0);
  assert.equal(heap.stats.liveObjects, 10000);
});

test('A06 blocks: lazy and eager sweep reclaim equal bytes including holes and reused handles', () => {
  const heap = collectorHeap({ blockSize: 4 });
  const roots = [];
  for (let index = 0; index < 43; index++) {
    const reference = heap.object(`N${index}`, [index]);
    if (index % 3 === 0) roots.push(reference);
  }
  heap.rootProvider = () => roots;
  const initial = heap.snapshot();
  const eager = heap.collect();
  heap.restore(initial);
  heap.collector.startIncremental();
  while (heap.collector.phase === 'mark') heap.collector.step(1);
  heap.collector.step(2);
  const partial = heap.snapshot();
  const lazy = finishCollection(heap, 1);
  assert.equal(lazy.freedThisCollection, eager.freedThisCollection);
  assert.equal(lazy.bytesThisCollection, eager.bytesThisCollection);
  heap.restore(partial);
  const replacement = heap.object('Reused', []);
  roots.push(replacement);
  finishCollection(heap, 2);
  assert(heap.tryGet(replacement));
  heap.collect();
  assert.equal(heap.stats.liveObjects, roots.length);
});

test('A06 blocks: allocation advances an in-flight sweep and handles keep identity checks', () => {
  const heap = collectorHeap({ blockSize: 2, allocationSliceBudget: 2 });
  const root = heap.object('Root', [null]);
  heap.rootProvider = () => [root];
  const dead = [];
  for (let index = 0; index < 20; index++) dead.push(heap.object('Dead', []));
  heap.collector.startIncremental();
  while (heap.collector.phase === 'mark') heap.collector.step(1);
  const before = heap.stats.freedObjects;
  heap.object('Newborn', []);
  assert(heap.stats.freedObjects > before);
  finishCollection(heap, 2);
  const reused = heap.object('Replacement', []);
  assert(!dead.some(reference => reference.h === reused.h && reference.g === reused.g));
  for (const reference of dead) assert.equal(heap.tryGet(reference), null);
});

test('A06 blocks: remembered entries cannot retain a reused slot through an obsolete identity', () => {
  const heap = collectorHeap({ generational: true, blockSize: 2, cardSize: 1 });
  const old = heap.object('Old', [null]);
  let root = old;
  heap.rootProvider = () => [root];
  heap.collect();
  heap.collect();
  const child = heap.object('Child', []);
  heap.writeField(old, 0, child);
  root = null;
  heap.collect();
  assert.equal(heap.collector.cards.cards.size, 0);
  const replacement = heap.object('Replacement', [null]);
  heap.collect([], { generation: 0 });
  assert.equal(heap.tryGet(replacement), null);
});
