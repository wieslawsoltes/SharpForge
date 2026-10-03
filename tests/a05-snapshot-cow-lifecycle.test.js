import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/heap.js';

for (const shared of [false, true]) {
  test(`T06 COW shared=${shared}: full-copy cyclic and aliased host payloads retain topology after restore`, () => {
    const heap = new ManagedHeap();
    const backing = [null];
    backing[0] = backing;
    const first = heap.object('object', backing);
    const second = heap.object('object', backing);
    heap.rootProvider = () => [first, second];
    const captured = heap.snapshot({shared});
    backing[0] = 'changed';
    heap.restore(captured);
    const left = heap.get(first).data;
    const right = heap.get(second).data;
    assert.equal(left, right);
    assert.equal(left[0], left);
    assert.notEqual(left, backing);
    assert.notEqual(left, captured.records[first.h].data);
    heap.writeData(first, 0, 9);
    assert.equal(right[0], 9);
    assert.equal(captured.records[first.h].data[0], captured.records[first.h].data);
  });
}

test('T06 COW unchanged immutable cyclic payloads reuse the captured record', () => {
  const heap = new ManagedHeap();
  const payload = {};
  payload.self = payload;
  Object.freeze(payload);
  const reference = heap.object('object', [payload]);
  heap.rootProvider = () => [reference];
  const first = heap.snapshot();
  const second = heap.snapshot();
  assert.equal(first.records[reference.h], second.records[reference.h]);
  heap.restore(first);
  assert.equal(heap.get(reference).data[0].self, heap.get(reference).data[0]);
});

test('T06 COW collection releases cache entries while saved snapshots retain isolated replay bytes', () => {
  const heap = new ManagedHeap();
  const first = heap.array('byte', 32);
  const strong = heap.createHandle(first);
  heap.writeData(first, 0, 17);
  const saved = heap.snapshot();
  heap.releaseHandle(strong);
  heap.collect();
  assert.equal(heap.snapshotRecords.size, 0);
  const later = heap.array('byte', 32);
  heap.writeData(later, 0, 99);
  heap.restore(saved);
  assert.equal(heap.getHandle(strong), first);
  assert.equal(heap.get(first).data[0], 17);
  assert.throws(() => heap.get(later), {name: 'InvalidReferenceException'});
  const next = heap.createHandle(first);
  assert(next.id > strong.id);
  heap.releaseHandle(strong);
  heap.releaseHandle(next);
  heap.collect();
  assert.equal(heap.snapshotRecords.size, 0);
  assert.equal(saved.records[first.h].data.read(0), 17);
});
