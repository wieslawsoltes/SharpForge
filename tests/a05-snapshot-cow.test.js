import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/heap.js';
import {ReadonlySnapshotArray} from '../packages/runtime/src/execution/snapshot-buffers.js';

test('COW snapshots share unchanged records and detach changed primitive backing', () => {
  const heap = new ManagedHeap();
  const first = heap.array('int', 4);
  const second = heap.array('long', 4);
  heap.rootProvider = () => [first, second];
  heap.writeData(first, 0, 17);
  heap.writeData(second, 2, 9007199254740993n);
  const before = heap.snapshot();
  const repeated = heap.snapshot();
  assert.equal(before.records[first.h], repeated.records[first.h]);
  assert.equal(before.generations, repeated.generations);
  assert.deepEqual(heap.lastSnapshot, {reusedRecords: 2, copiedRecords: 0});
  heap.writeData(first, 0, 29);
  const after = heap.snapshot();
  assert.notEqual(before.records[first.h], after.records[first.h]);
  assert.equal(before.records[second.h], after.records[second.h]);
  assert.equal(before.records[first.h].data.read(0), 17);
  assert.equal(after.records[first.h].data.read(0), 29);
  assert.equal(before.records[second.h].data.read(2), 9007199254740993n);
  heap.restore(before);
  assert.equal(heap.get(first).data[0], 17);
  heap.writeData(first, 0, 43);
  assert.equal(before.records[first.h].data.read(0), 17);
});

test('COW capture observes legacy writes through retained host views and preserves raw NaN payloads', () => {
  const heap = new ManagedHeap();
  const value = heap.array('double', 2);
  heap.rootProvider = () => [value];
  const data = heap.get(value).data;
  const words = new BigUint64Array(data.buffer);
  words[0] = 0x7ff8000000000001n;
  const before = heap.snapshot();
  words[0] = 0x7ff8000000000002n;
  data[1] = -0;
  const after = heap.snapshot();
  assert.notEqual(before.records[value.h], after.records[value.h]);
  const original = before.records[value.h].data.toMutableArray();
  assert.equal(new BigUint64Array(original.buffer)[0], 0x7ff8000000000001n);
  heap.restore(after);
  assert.equal(new BigUint64Array(heap.get(value).data.buffer)[0], 0x7ff8000000000002n);
  assert.ok(Object.is(heap.get(value).data[1], -0));
});

test('readonly snapshot backing never exposes mutable bytes', () => {
  const original = new Uint8Array([1, 2, 3]);
  const saved = new ReadonlySnapshotArray(original);
  original[0] = 9;
  const restored = saved.toMutableArray();
  restored[1] = 9;
  assert.deepEqual([...saved], [1, 2, 3]);
  assert.throws(() => { saved.length = 99; }, TypeError);
});

test('mutable nested host values retain full-copy isolation instead of unsafe sharing', () => {
  const heap = new ManagedHeap();
  const state = {values: [1], metadata: new Map([['step', 1]])};
  const reference = heap.object('object', [state]);
  heap.rootProvider = () => [reference];
  const before = heap.snapshot();
  state.values[0] = 2;
  state.metadata.set('step', 2);
  const after = heap.snapshot();
  assert.notEqual(before.records[reference.h], after.records[reference.h]);
  assert.equal(before.records[reference.h].data[0].values[0], 1);
  assert.equal(after.records[reference.h].data[0].metadata.get('step'), 2);
});

test('collection and handle reuse never reuse a stale COW record', () => {
  const heap = new ManagedHeap();
  const first = heap.array('byte', 1);
  heap.writeData(first, 0, 10);
  const before = heap.snapshot();
  heap.collect();
  const replacement = heap.array('byte', 1);
  heap.writeData(replacement, 0, 20);
  assert.equal(first.h, replacement.h);
  assert.notEqual(first.g, replacement.g);
  const after = heap.snapshot();
  assert.notEqual(before.records[first.h], after.records[replacement.h]);
  assert.equal(before.records[first.h].data.read(0), 10);
  assert.equal(after.records[replacement.h].data.read(0), 20);
});

test('128 snapshots with one percent record mutation retain less than twice a 10 MiB heap payload', () => {
  const heap = new ManagedHeap({maxBytes: 64 * 1024 * 1024, initialThreshold: 64 * 1024 * 1024});
  const roots = [];
  heap.rootProvider = () => roots;
  for (let index = 0; index < 4096; index++) {
    const text = heap.string(String(index).padStart(6, '0') + 'x'.repeat(1250));
    roots.push(heap.object('object', [text, 0]));
  }
  assert.ok(heap.stats.liveBytes >= 10 * 1024 * 1024);
  const snapshots = [];
  const mutationCount = Math.ceil(roots.length / 100);
  for (let revision = 0; revision < 128; revision++) {
    for (let index = 0; index < mutationCount; index++) {
      heap.writeData(roots[(revision * mutationCount + index) % roots.length], 1, revision + 1);
    }
    snapshots.push(heap.snapshot());
  }
  const records = new Set(snapshots.flatMap(snapshot => snapshot.records).filter(Boolean));
  const generations = new Set(snapshots.map(snapshot => snapshot.generations));
  const retainedPayload = [...records].reduce((sum, record) => sum + record.size, 0)
    + snapshots.reduce((sum, snapshot) => sum + snapshot.records.length * 8, 0)
    + [...generations].reduce((sum, values) => sum + values.length * 8, 0);
  assert.ok(retainedPayload < heap.stats.liveBytes * 2, `${retainedPayload} vs ${heap.stats.liveBytes * 2}`);
  for (const saved of [snapshots[0], snapshots[63], snapshots[127]]) {
    heap.restore(saved);
    const baseline = heap.snapshot({shared: false});
    for (const reference of roots) {
      assert.equal(baseline.records[reference.h].data[1], saved.records[reference.h].data[1]);
    }
  }
});
