import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRetained, collectorHeap, randomGenerator, reachableReferences } from './a06-collector-fixtures.js';

function traceHeap(generational) {
  const heap = collectorHeap({ generational });
  const roots = [null, null, null];
  const references = new Map();
  heap.rootProvider = () => roots;
  return { heap, roots, references };
}

function logicalLiveSet(heap) {
  return heap.records.filter(Boolean).map(record => record.data[0]).sort((left, right) => left - right);
}

function applyAction(trace, action) {
  const { heap, roots, references } = trace;
  if (action.kind === 'allocate') {
    const reference = heap.object('TraceNode', [action.id, null, null]);
    references.set(action.id, reference);
    heap.writeRoot(roots, action.slot, reference);
  } else if (action.kind === 'garbage') {
    heap.object('TraceNode', [action.id, null, null]);
  } else if (action.kind === 'root') {
    heap.writeRoot(roots, action.slot, action.target === null ? null : references.get(action.target));
  } else {
    heap.writeField(references.get(action.owner), action.slot, action.target === null ? null : references.get(action.target));
  }
}

test('A06 differential: 100 seeded mutator traces preserve roots at every minor and agree after full collections', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const random = randomGenerator(seed);
    const baseline = traceHeap(false);
    const nursery = traceHeap(true);
    let identity = 0;
    for (let index = 0; index < 120; index++) {
      const reachable = reachableReferences(baseline.heap, baseline.roots).map(reference => baseline.heap.get(reference).data[0]);
      const kind = reachable.length === 0 ? 0 : random() % 4;
      let action;
      if (kind === 0) action = { kind: 'allocate', id: identity++, slot: random() % 3 };
      else if (kind === 1) action = { kind: 'garbage', id: identity++ };
      else if (kind === 2) action = { kind: 'root', slot: random() % 3,
        target: random() % 4 === 0 ? null : reachable[random() % reachable.length] };
      else action = { kind: 'store', owner: reachable[random() % reachable.length], slot: 1 + random() % 2,
        target: random() % 4 === 0 ? null : reachable[random() % reachable.length] };
      applyAction(baseline, action);
      applyAction(nursery, action);
      if (index % 3 === 0) {
        const expected = reachableReferences(nursery.heap, nursery.roots);
        nursery.heap.collect([], { generation: random() % 2 });
        assertRetained(nursery.heap, expected);
      }
      if (index % 10 === 0) {
        baseline.heap.collect();
        nursery.heap.collect();
        assert.deepEqual(logicalLiveSet(nursery.heap), logicalLiveSet(baseline.heap), `Seed ${seed}, action ${index}`);
      }
    }
    baseline.heap.collect();
    nursery.heap.collect();
    assert.deepEqual(logicalLiveSet(nursery.heap), logicalLiveSet(baseline.heap), `Seed ${seed}, final collection`);
  }
});

test('A06 tuning: nursery budgets respond to both high and low survival without exceeding configured limits', () => {
  const heap = collectorHeap({ generational: true, nurseryBytes: 4096, minNurseryBytes: 1024, maxNurseryBytes: 8192 });
  let roots = [];
  heap.rootProvider = () => roots;
  for (let index = 0; index < 20; index++) roots.push(heap.object('Retained', [null]));
  const initial = heap.collector.budgets.budgets[0];
  heap.collect();
  const highSurvival = heap.collector.budgets.budgets[0];
  assert(highSurvival < initial);
  roots = [];
  for (let index = 0; index < 20; index++) heap.object('Temporary', [null]);
  heap.collect();
  const lowSurvival = heap.collector.budgets.budgets[0];
  assert(lowSurvival > highSurvival);
  assert(lowSurvival >= 1024 && lowSurvival <= 8192);
});

test('A06 tuning: promotion growth can trigger generation two before the hard heap cap', () => {
  const heap = collectorHeap({ generational: true, nurseryBytes: 128, minNurseryBytes: 128,
    maxNurseryBytes: 128, gen1Budget: 128, gen2Budget: 128 });
  const roots = [];
  heap.rootProvider = () => roots;
  for (let index = 0; index < 100; index++) roots.push(heap.object('Survivor', [index]));
  assert(heap.stats.generationCollections[2] > 0);
  assert(heap.stats.peakBytes < heap.maxBytes);
  assert.equal(heap.stats.liveObjects, roots.length);
});
