import test from 'node:test';
import assert from 'node:assert/strict';
import { collectorHeap, finishCollection } from './a06-collector-fixtures.js';

test('A06 generations: survivors age 0 -> 1 -> 2 without changing handle identity', () => {
  const heap = collectorHeap({ generational: true });
  const reference = heap.object('Node', [null]);
  heap.rootProvider = () => [reference];
  assert.equal(heap.getGeneration(reference), 0);
  heap.collect([], { generation: 0 });
  assert.equal(heap.getGeneration(reference), 1);
  heap.collect([], { generation: 1 });
  assert.equal(heap.getGeneration(reference), 2);
  assert.equal(heap.generations[reference.h], reference.g);
  assert.deepEqual(heap.stats.generationCounts, [0, 0, 1]);
  assert.deepEqual(heap.stats.generationCollections, [2, 1, 0]);
});

test('A06 generations: nursery garbage is collected without tracing mature root objects', () => {
  const heap = collectorHeap({ generational: true });
  const old = heap.object('Old', [null]);
  heap.rootProvider = () => [old];
  heap.collect();
  heap.collect();
  const garbage = heap.object('Young', [null]);
  const result = heap.collect([], { generation: 0 });
  assert.equal(result.freedThisCollection, 1);
  assert.equal(result.markedObjects, 0);
  assert.equal(result.edgesScanned, 0);
  assert.equal(heap.tryGet(garbage), null);
  assert(heap.tryGet(old));
});

test('A06 generations: old-to-young stores survive 1000 nursery collections with one remembered owner', () => {
  const heap = collectorHeap({ generational: true });
  const old = heap.object('Old', [null]);
  heap.rootProvider = () => [old];
  heap.collect();
  heap.collect();
  let last = null;
  for (let iteration = 0; iteration < 1000; iteration++) {
    last = heap.object('Young', [iteration]);
    heap.writeField(old, 0, last);
    const result = heap.collect([], { generation: 0 });
    assert(heap.tryGet(last));
    assert.equal(result.markedObjects, 1);
    assert.equal(result.ownersScanned, 1);
    assert.equal(result.cardsScanned, 1);
  }
  heap.collect([], { generation: 1 });
  assert.equal(heap.stats.liveObjects, 2);
  assert.equal(heap.getGeneration(last), 2);
  heap.writeField(old, 0, null);
  heap.collect([], { generation: 0 });
  assert.equal(heap.collector.cards.cards.size, 0);
});

test('A06 cards: writes into an already scanned prefix keep the card dirty', () => {
  const heap = collectorHeap({ generational: true, largeObjectThreshold: 1000000 });
  const old = heap.object('OldArrayLike', Array(100).fill(null));
  heap.rootProvider = () => [old];
  heap.collect();
  heap.collect();
  const initial = heap.object('Initial', []);
  const late = heap.object('Late', []);
  heap.writeField(old, 90, initial);
  heap.collector.startIncremental({ generation: 0 });
  heap.collector.step(2);
  heap.writeField(old, 0, late);
  heap.writeField(old, 90, null);
  finishCollection(heap, 3);
  assert(heap.tryGet(late));
  assert.equal(heap.getGeneration(late), 1);
  assert.equal(heap.collector.cards.cards.size, 1);
  heap.collect([], { generation: 1 });
  assert(heap.tryGet(late));
});

test('A06 generations: promotion pressure escalates to full collection before reclaiming anything', () => {
  const heap = collectorHeap({ generational: true, gen1PromotionLimit: 16 });
  const oldGarbage = heap.object('OldGarbage', [null]);
  let root = oldGarbage;
  heap.rootProvider = () => [root];
  heap.collect();
  heap.collect();
  root = heap.object('YoungSurvivor', [null]);
  const result = heap.collect([], { generation: 0 });
  assert.equal(result.escalated, true);
  assert.equal(result.generation, 2);
  assert(heap.tryGet(root));
  assert.equal(heap.tryGet(oldGarbage), null);
});

test('A06 budgets: allocation-heavy nursery mode avoids repeated full collections within the same memory cap', context => {
  const options = { maxBytes: 65536, initialThreshold: 4096, nurseryBytes: 4096, maxNurseryBytes: 4096 };
  const baseline = collectorHeap(options);
  const generational = collectorHeap({ ...options, generational: true });
  for (let index = 0; index < 2000; index++) {
    baseline.object('Temporary', [index]);
    generational.object('Temporary', [index]);
  }
  context.diagnostic(JSON.stringify({issue: 'SF-A06-T07.4', allocations: 2000, maxBytes: options.maxBytes,
    baselineCollections: baseline.stats.generationCollections, nurseryCollections: generational.stats.generationCollections,
    baselinePeakBytes: baseline.stats.peakBytes, nurseryPeakBytes: generational.stats.peakBytes}));
  assert(baseline.stats.generationCollections[2] >= 5);
  assert(baseline.stats.generationCollections[2] >= 5 * Math.max(1, generational.stats.generationCollections[2]));
  assert(generational.stats.generationCollections[0] > 0);
  assert(baseline.stats.peakBytes <= options.maxBytes);
  assert(generational.stats.peakBytes <= options.maxBytes);
});

test('A06 B01: a 4 KiB initial threshold remains the collection floor after empty collections', () => {
  const heap = collectorHeap({ initialThreshold: 4096 });
  heap.object('Garbage', []);
  heap.collect();
  assert.equal(heap.threshold, 4096);
  for (let index = 0; index < 1000; index++) heap.object('Garbage', []);
  assert(heap.stats.collections >= 4);
  heap.collect();
  assert.equal(heap.threshold, 4096);
});

test('A06 budgets: uncollected generations keep their targets as surviving objects are promoted', () => {
  const heap = collectorHeap({ generational: true, nurseryBytes: 4096, minNurseryBytes: 4096,
    maxNurseryBytes: 4096, gen1Budget: 128, gen2Budget: 128 });
  const roots = [];
  heap.rootProvider = () => roots;
  for (let index = 0; index < 8; index++) roots.push(heap.object('Retained', [index]));
  const policy = heap.collector.budgets;
  heap.collect([], { generation: 0 });
  assert(heap.stats.generationBytes[1] > 128);
  assert.equal(policy.budgets[1], 128, 'a minor collection cannot move the generation one target');
  assert.equal(policy.generationForAllocation(4096), 1);
  heap.collect([], { generation: 1 });
  assert(heap.stats.generationBytes[2] > 128);
  assert.equal(policy.budgets[2], 128, 'generation one promotion cannot move the generation two target');
  assert.equal(policy.generationForAllocation(1), 2);
  heap.collect([], { generation: 2 });
  assert.equal(policy.budgets[2], heap.stats.generationBytes[2] * 2);
  assert.equal(policy.generationForAllocation(1), null);
});

test('A06 budgets: explicit threshold policy and invalid configuration are observable', () => {
  const heap = collectorHeap({ initialThreshold: 1024, thresholdPolicy: ({ initialThreshold }) => initialThreshold * 3 });
  heap.collect();
  assert.equal(heap.threshold, 3072);
  assert.throws(() => collectorHeap({ nurseryBytes: 0 }), RangeError);
  assert.throws(() => collectorHeap({ minNurseryBytes: 200, maxNurseryBytes: 100 }), RangeError);
  assert.throws(() => heap.collect([], { generation: -1 }), RangeError);
  assert.throws(() => heap.collect([], { generation: 3 }), RangeError);
  assert.throws(() => heap.collector.step(0), RangeError);
  assert.throws(() => heap.collector.step(1.5), RangeError);
});
