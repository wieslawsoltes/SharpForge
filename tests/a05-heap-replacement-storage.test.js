import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '@sharpforge/runtime';
import {float} from '@sharpforge/bytecode';

for (const [type, constructor, input, expected] of [
  ['int', Int32Array, [1, -2, 3], [1, -2, 3]],
  ['byte', Uint8Array, [0, 255, 256], [0, 255, 0]],
  ['long', BigInt64Array, [1n, -2n, 3n], [1n, -2n, 3n]],
  ['float', Float32Array, [float(-0), float(1.1), float(NaN)], [-0, Math.fround(1.1), NaN]],
  ['double', Float64Array, [float(-0), float(Infinity), float(NaN)], [-0, Infinity, NaN]]
]) test(`${type}: replacement retains declared storage width, ownership and precise byte growth`, () => {
  const heap = new ManagedHeap();
  const reference = heap.array(type, 1);
  const handle = heap.createHandle(reference);
  const snapshot = heap.snapshot();
  const before = {...heap.stats};
  heap.replaceData(reference, input);
  const record = heap.get(reference);
  assert(record.data instanceof constructor);
  assert.deepEqual([...record.data], expected);
  assert.equal(record.size, 32 + expected.length * constructor.BYTES_PER_ELEMENT);
  assert.equal(heap.stats.allocations, before.allocations);
  assert.equal(heap.stats.allocatedBytes - before.allocatedBytes, 2 * constructor.BYTES_PER_ELEMENT);
  assert.equal(heap.stats.liveBytes, record.size);
  const copy = record.data.slice();
  heap.replaceData(reference, copy);
  copy[0] = type === 'long' ? 99n : 99;
  assert.deepEqual([...heap.get(reference).data], expected, 'the caller does not retain owned backing');
  heap.restore(snapshot);
  assert(heap.get(reference).data instanceof constructor);
  assert.equal(heap.get(reference).data.length, 1, 'an earlier COW capture retains its independent bytes');
  heap.releaseHandle(handle);
});

test('failed conversion and reservation commit no record, allocation accounting or mutation revision', () => {
  for (const failure of ['conversion', 'budget']) {
    const heap = new ManagedHeap();
    const reference = heap.array('long', 1);
    heap.get(reference).data[0] = 7n;
    const record = heap.get(reference);
    const data = record.data;
    const before = {...heap.stats};
    const revision = heap.mutationRevision;
    if (failure === 'budget') heap.maxBytes = record.size;
    const replacement = failure === 'conversion' ? [1n, Symbol('invalid long')] : [1n, 2n];
    assert.throws(() => heap.replaceData(reference, replacement),
      {name: failure === 'conversion' ? 'TypeError' : 'OutOfMemoryException'});
    assert.equal(record.data, data);
    assert.deepEqual([...record.data], [7n]);
    assert.equal(record.size, 40);
    assert.deepEqual(heap.stats, before);
    assert.equal(heap.mutationRevision, revision);
  }
});

test('reference records retain slot widths and new child roots survive admission collection', () => {
  const heap = new ManagedHeap();
  const reference = heap.array('object', 1);
  const child = heap.string('retained');
  heap.threshold = heap.stats.liveBytes;
  heap.replaceData(reference, [null, child]);
  assert.equal(heap.get(child).data, 'retained');
  assert(Array.isArray(heap.get(reference).data));
  assert.equal(heap.get(reference).size, 48);
  assert.equal(heap.stats.collections, 1);
});

test('readonly snapshot replacement preserves primitive NaN payload bits', () => {
  const heap = new ManagedHeap();
  const reference = heap.array('double', 1);
  const original = heap.get(reference).data;
  const bytes = new Uint8Array(original.buffer, original.byteOffset, original.byteLength);
  const view = new DataView(original.buffer, original.byteOffset, original.byteLength);
  view.setBigUint64(0, 0x7ff8000000000001n, true);
  const expected = bytes.slice();
  const snapshot = heap.snapshot();
  bytes.fill(0);
  heap.replaceData(reference, snapshot.records[reference.h].data);
  const restored = heap.get(reference).data;
  assert(restored instanceof Float64Array);
  assert.deepEqual(new Uint8Array(restored.buffer, restored.byteOffset, restored.byteLength), expected);
  assert.notEqual(restored, original);
});
