import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRetained, collectorHeap, finishCollection, randomGenerator, reachableReferences } from './a06-collector-fixtures.js';

function graphHeap() {
  const heap = collectorHeap();
  const objects = Array.from({ length: 12 }, (_, index) => heap.object(`Node${index}`, [null, null]));
  for (let index = 0; index < 8; index++) heap.writeField(objects[index], 0, objects[(index + 1) % 8]);
  heap.writeField(objects[2], 1, objects[9]);
  heap.writeField(objects[10], 1, objects[11]);
  heap.writeField(objects[11], 1, objects[10]);
  heap.rootProvider = () => [objects[0]];
  return { heap, objects };
}

test('A06 incremental: eager and sliced tracing retain the same cyclic graph', () => {
  const eager = graphHeap();
  const sliced = graphHeap();
  const expected = eager.heap.collect();
  sliced.heap.collector.startIncremental();
  const actual = finishCollection(sliced.heap, 3);
  assert.equal(actual.freedThisCollection, expected.freedThisCollection);
  assert.equal(actual.bytesThisCollection, expected.bytesThisCollection);
  assert.deepEqual(sliced.heap.records.map(record => record?.type ?? null), eager.heap.records.map(record => record?.type ?? null));
});

test('A06 incremental: very wide objects are scanned by reference-slot budget', () => {
  const heap = collectorHeap({ largeObjectThreshold: 2000000 });
  const leaf = heap.object('Leaf', []);
  const owner = heap.object('Wide', Array(10000).fill(leaf));
  heap.rootProvider = () => [owner];
  heap.collector.startIncremental();
  const slice = heap.collector.step(13);
  assert.equal(slice.work, 13);
  assert.equal(heap.collector.marker.statistics.edgesScanned, 12);
  assert.equal(heap.collector.phase, 'mark');
  const result = finishCollection(heap, 13);
  assert.equal(result.freedThisCollection, 0);
  assert.equal(result.edgesScanned, 10000);
});

test('A06 incremental: insertion into black and partially scanned grey owners shades white children', () => {
  for (const prefixBudget of [2, 3]) {
    const heap = collectorHeap();
    const busy = heap.object('Busy', Array(40).fill(null));
    const owner = heap.object('Owner', [null, null]);
    const child = heap.object('Child', []);
    heap.rootProvider = () => [busy, owner];
    heap.collector.startIncremental();
    heap.collector.step(prefixBudget);
    assert.equal(heap.collector.phase, 'mark');
    heap.writeField(owner, 0, child);
    finishCollection(heap, 2);
    assert(heap.tryGet(child));
    assert.equal(heap.get(owner).data[0], child);
  }
});

test('A06 incremental: allocation is black and initialized references are shaded before publication', () => {
  const heap = collectorHeap({ allocationSliceBudget: 1 });
  const busy = heap.object('Busy', Array(40).fill(null));
  const child = heap.object('ExistingWhiteChild', []);
  heap.rootProvider = () => [busy];
  heap.collector.startIncremental();
  const newborn = heap.object('Newborn', [child]);
  assert.equal(heap.collector.marker.color(newborn), 2);
  assert(heap.collector.marker.isMarked(child));
  finishCollection(heap, 3);
  assert(heap.tryGet(newborn));
  assert(heap.tryGet(child));
  assert.equal(heap.getGeneration(newborn), 0);
});

test('A06 incremental: final atomic root rescan discovers a newly supplied root provider', () => {
  const heap = collectorHeap();
  const busy = heap.object('Busy', Array(40).fill(null));
  const late = heap.object('LateRoot', []);
  heap.rootProvider = () => [busy];
  heap.collector.startIncremental();
  heap.collector.step(2);
  heap.rootProvider = () => [busy, late];
  finishCollection(heap, 3);
  assert(heap.tryGet(late));
});

test('A06 lazy sweep: a newly published unswept closure is shaded before further reclamation', () => {
  const heap = collectorHeap({ blockSize: 1 });
  const owner = heap.object('RootOwner', [null]);
  const firstGarbage = heap.object('FirstGarbage', []);
  const late = heap.object('LateParent', [null]);
  const child = heap.object('LateChild', []);
  heap.writeField(late, 0, child);
  heap.rootProvider = () => [owner];
  heap.collector.startIncremental();
  while (heap.collector.phase === 'mark') heap.collector.step(1);
  heap.collector.step(1);
  assert.equal(heap.tryGet(firstGarbage), null);
  assert(heap.tryGet(late));
  heap.writeField(owner, 0, late);
  finishCollection(heap, 1);
  assertRetained(heap, [owner, late, child]);
});

test('A06 nonblocking: collect schedules cooperative work and rejects overlapping explicit starts', () => {
  const heap = collectorHeap();
  const root = heap.object('Root', Array(40).fill(null));
  heap.rootProvider = () => [root];
  const result = heap.collect([], { blocking: false });
  assert.equal(result.active, true);
  assert.equal(heap.stats.collections, 0);
  assert.throws(() => heap.collector.startIncremental(), /already active/);
  finishCollection(heap, 2);
  assert.equal(heap.stats.collections, 1);
});

test('A06 incremental: snapshot restores partially scanned marking and remembered work', () => {
  const { heap, objects } = graphHeap();
  heap.collector.startIncremental();
  heap.collector.step(5);
  const snapshot = heap.snapshot();
  const expected = finishCollection(heap, 2);
  heap.restore(snapshot);
  assert.equal(heap.collector.phase, 'mark');
  heap.writeField(objects[0], 1, objects[10]);
  const expanded = finishCollection(heap, 2);
  assert.equal(expanded.freedThisCollection, expected.freedThisCollection - 2);
  heap.restore(snapshot);
  const replay = finishCollection(heap, 2);
  assert.equal(replay.freedThisCollection, expected.freedThisCollection);
});

test('A06 incremental: 10000 deterministic mutator schedules preserve the final reachable closure', () => {
  for (let schedule = 0; schedule < 10000; schedule++) {
    const random = randomGenerator(schedule + 1);
    const heap = collectorHeap({ allocationSliceBudget: 1 });
    const objects = Array.from({ length: 5 }, (_, index) => heap.object(`N${index}`, [null, null]));
    for (const owner of objects) {
      for (let slot = 0; slot < 2; slot++) {
        const value = random() % 7;
        if (value < objects.length) heap.writeField(owner, slot, objects[value]);
      }
    }
    const roots = [objects[0], objects[1]];
    heap.rootProvider = () => roots;
    heap.collector.startIncremental();
    for (let mutation = 0; mutation < 8 && heap.collector.phase === 'mark'; mutation++) {
      const owner = objects[random() % objects.length];
      const target = objects[random() % objects.length];
      heap.writeField(owner, random() % 2, target);
      if (mutation % 3 === 0) heap.writeRoot(roots, 0, objects[random() % objects.length]);
      heap.collector.step(1);
    }
    const expected = reachableReferences(heap, roots);
    finishCollection(heap, 2);
    assertRetained(heap, expected);
  }
});
