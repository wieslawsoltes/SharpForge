import test from 'node:test';
import assert from 'node:assert/strict';
import { collectorHeap, finishCollection } from './a06-collector-fixtures.js';

function assertGenerationAccounting(heap) {
  const counts = [0, 0, 0];
  const bytes = [0, 0, 0];
  for (const record of heap.records) {
    if (!record) continue;
    counts[record.gcGeneration]++;
    bytes[record.gcGeneration] += record.size;
  }
  assert.deepEqual(heap.stats.generationCounts, counts);
  assert.deepEqual(heap.stats.generationBytes, bytes);
  assert.equal(bytes.reduce((total, value) => total + value, 0), heap.stats.liveBytes);
}

test('A06 resize: crossing the large-object boundary migrates generation counters and remembers young references', () => {
  const heap = collectorHeap({ generational: true, largeObjectThreshold: 128 });
  const child = heap.object('Child', []);
  const owner = heap.object('Resizable', [child, null]);
  heap.rootProvider = () => [owner];
  assert.equal(heap.getGeneration(owner), 0);
  heap.replaceData(owner, Array(30).fill(child));
  assert.equal(heap.get(owner).space, 'large');
  assert.equal(heap.getGeneration(owner), 2);
  assertGenerationAccounting(heap);
  heap.collect([], { generation: 0 });
  assert(heap.tryGet(child));
  assert.equal(heap.getGeneration(child), 1);
  assertGenerationAccounting(heap);
});

test('A06 resize: shrinking a partially scanned object resets its edge cursor without negative work', () => {
  const heap = collectorHeap({ allocationSliceBudget: 1 });
  const busy = heap.object('Busy', Array(100).fill(null));
  const owner = heap.object('Resizable', Array(100).fill(null));
  const child = heap.object('Child', []);
  heap.rootProvider = () => [busy, owner];
  heap.collector.startIncremental();
  heap.collector.step(10);
  assert.equal(heap.collector.marker.cursor.handle, owner.h);
  assert(heap.collector.marker.cursor.next > 1);
  heap.replaceData(owner, [child]);
  finishCollection(heap, 3);
  assert(heap.tryGet(child));
  assertGenerationAccounting(heap);
  assert(heap.stats.markedBytesByGeneration.every(bytes => bytes >= 0));
});

test('A06 resize: growth during sliced promotion preserves original mark-generation byte accounting', () => {
  const heap = collectorHeap({ allocationSliceBudget: 1, largeObjectThreshold: 128 });
  const child = heap.object('Child', []);
  const owner = heap.object('Resizable', [child]);
  heap.rootProvider = () => [owner];
  heap.collector.startIncremental();
  while (heap.collector.active && heap.collector.phase !== 'promote') heap.collector.step(1);
  heap.collector.step(1);
  assert.equal(heap.getGeneration(owner), 1);
  heap.replaceData(owner, Array(30).fill(child));
  finishCollection(heap, 2);
  assert.equal(heap.getGeneration(owner), 2);
  assert(heap.tryGet(child));
  assertGenerationAccounting(heap);
  assert(heap.stats.markedBytesByGeneration.every(bytes => bytes >= 0));
});

test('A06 bulk: reference filling dirties an old owner once and shades inserted children during marking', () => {
  const heap = collectorHeap({ generational: true });
  const owner = heap.array('Node', 128);
  heap.rootProvider = () => [owner];
  heap.collect();
  heap.collect();
  const busy = heap.object('Busy', Array(100).fill(null));
  const child = heap.object('Child', []);
  heap.rootProvider = () => [owner, busy];
  heap.collector.startIncremental({ generation: 0 });
  const before = heap.collector.cards.mutationSerial;
  heap.fillArray(owner, 3, 40, child);
  assert.equal(heap.collector.cards.mutationSerial - before, 1);
  assert(heap.collector.marker.isMarked(child));
  finishCollection(heap, 3);
  assert(heap.tryGet(child));
  heap.fillArray(owner, 3, 40, null);
  heap.collect([], { generation: 0 });
  assert.equal(heap.collector.cards.cards.size, 0);
});

test('A06 bulk: bitmap reference scanning respects the overwritten raw-slot range', () => {
  const heap = collectorHeap();
  heap.methodTables.define({ name: 'TypedHolder', fields: [
    { name: 'Count', type: 'int' }, { name: 'Left', type: 'Node' },
    { name: 'Number', type: 'int' }, { name: 'Right', type: 'Node' }
  ] });
  const owner = heap.object('TypedHolder', [0, null, 0, null]);
  const busy = heap.object('Busy', Array(100).fill(null));
  const inside = heap.object('Inside', []);
  const outside = heap.object('Outside', []);
  heap.rootProvider = () => [busy, owner];
  heap.collector.startIncremental();
  heap.collector.step(3);
  assert.equal(heap.collector.marker.color(owner), 2);
  heap.get(owner).data[1] = inside;
  heap.get(owner).data[3] = outside;
  heap.collector.bulkWriteBarrier(owner, 1, 1);
  assert(heap.collector.marker.isMarked(inside));
  assert.equal(heap.collector.marker.isMarked(outside), false);
  heap.writeField(owner, 3, outside);
  finishCollection(heap, 3);
  assert(heap.tryGet(inside));
  assert(heap.tryGet(outside));
});

test('A06 suspension: direct, automatic and incremental collection cannot pass a running mutator', () => {
  const heap = collectorHeap({ initialThreshold: 32 });
  const root = heap.object('Root', [null]);
  heap.rootProvider = () => [root];
  const lease = heap.safepoints.register('mutator', { parked: false });
  assert.throws(() => heap.collector.collect(), { name: 'InvalidOperationException' });
  assert.throws(() => heap.object('Trigger', [null]), { name: 'InvalidOperationException' });
  assert.equal(heap.stats.allocations, 1);
  heap.safepoints.poll('mutator', 'allocation');
  heap.collector.startIncremental();
  heap.safepoints.leave('mutator');
  assert.throws(() => heap.collector.step(1), { name: 'InvalidOperationException' });
  heap.safepoints.poll('mutator', 'slice-boundary');
  finishCollection(heap, 1);
  assert.equal(heap.safepoints.suspension, null);
  assert(heap.tryGet(root));
  lease.dispose();
});

test('A06 disposal: tearing down an incremental collection releases records and prevents continuation', () => {
  const heap = collectorHeap();
  const root = heap.object('Root', Array(100).fill(null));
  heap.rootProvider = () => [root];
  heap.collector.startIncremental();
  heap.collector.step(3);
  heap.dispose();
  assert.equal(heap.collector.active, false);
  assert.equal(heap.stats.liveObjects, 0);
  assertGenerationAccounting(heap);
  assert.throws(() => heap.collector.step(1), { name: 'ObjectDisposedException' });
});
