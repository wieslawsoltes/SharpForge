import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '@sharpforge/runtime';
import {ReadonlySnapshotArray} from '../packages/runtime/src/execution/snapshot-buffers.js';

const element = (record, index) => record.data instanceof ReadonlySnapshotArray ? record.data.read(index) : record.data[index];

test('COW captures reuse unchanged records and detach host writes before another capture', () => {
  const heap = new ManagedHeap(), first = heap.array('int', 4), second = heap.array('long', 4);
  heap.rootProvider = () => [first, second];
  heap.get(first).data[0] = 17;
  const before = heap.snapshot(), repeated = heap.snapshot();
  assert.equal(before.records[first.h], repeated.records[first.h]);
  assert.equal(before.generations, repeated.generations);
  assert.deepEqual(heap.lastSnapshot, {reusedRecords: 2, copiedRecords: 0});
  heap.get(first).data[0] = 29;
  const after = heap.snapshot();
  assert.notEqual(before.records[first.h], after.records[first.h]);
  assert.equal(before.records[second.h], after.records[second.h]);
  assert.equal(element(before.records[first.h], 0), 17);
  assert.equal(element(after.records[first.h], 0), 29);
  heap.restore(before);
  heap.get(first).data[0] = 43;
  assert.equal(element(before.records[first.h], 0), 17);
});

test('snapshot typed backing preserves NaN payload bits and never exposes writable captured storage', () => {
  const heap = new ManagedHeap(), reference = heap.allocate('array', 'double[]', new Float64Array(2));
  heap.rootProvider = () => [reference];
  const data = heap.get(reference).data, words = new BigUint64Array(data.buffer);
  words[0] = 0x7ff8000000000001n;
  const saved = heap.snapshot();
  words[0] = 0x7ff8000000000002n;
  data[1] = -0;
  const after = heap.snapshot();
  const writable = saved.records[reference.h].data.toMutableArray();
  assert.equal(new BigUint64Array(writable.buffer)[0], 0x7ff8000000000001n);
  writable[0] = 0;
  heap.restore(after);
  assert.equal(new BigUint64Array(heap.get(reference).data.buffer)[0], 0x7ff8000000000002n);
  assert(Object.is(heap.get(reference).data[1], -0));
});

for (const shared of [false, true]) {
  test(`shared=${shared}: mutable cycles and backing aliases remain independent after restore`, () => {
    const heap = new ManagedHeap(), data = [null];
    data[0] = data;
    const left = heap.object('object', data), right = heap.object('object', data);
    heap.rootProvider = () => [left, right];
    const saved = heap.snapshot({shared});
    data[0] = 'changed';
    heap.restore(saved);
    assert.equal(heap.get(left).data, heap.get(right).data);
    assert.equal(heap.get(left).data[0], heap.get(left).data);
    assert.notEqual(heap.get(left).data, saved.records[left.h].data);
    assert.equal(saved.records[left.h].data[0], saved.records[left.h].data);
  });
}

test('collection and reused slots cannot inherit another generation\'s shared record', () => {
  const heap = new ManagedHeap(), first = heap.array('byte', 1);
  heap.get(first).data[0] = 10;
  const saved = heap.snapshot();
  heap.collect();
  const second = heap.array('byte', 1);
  heap.get(second).data[0] = 20;
  assert.equal(first.h, second.h);
  assert.notEqual(first.g, second.g);
  const newer = heap.snapshot();
  assert.notEqual(saved.records[first.h], newer.records[second.h]);
  assert.equal(element(saved.records[first.h], 0), 10);
  heap.restore(saved);
  assert.equal(heap.get(first).data[0], 10);
  assert.throws(() => heap.get(second), {name: 'InvalidReferenceException'});
});

for (const shared of [false, true]) {
  test(`shared=${shared}: different typed views preserve buffer aliases, offsets and independent snapshots`, () => {
    const heap = new ManagedHeap(), buffer = new ArrayBuffer(16);
    const words = heap.allocate('array', 'int[]', new Int32Array(buffer));
    const bytes = heap.allocate('array', 'byte[]', new Uint8Array(buffer, 4, 8));
    heap.rootProvider = () => [words, bytes];
    heap.get(bytes).data[0] = 17;
    const saved = heap.snapshot({shared});
    assert.equal(saved.records[words.h].data.buffer, saved.records[bytes.h].data.buffer);
    assert.equal(saved.records[bytes.h].data.byteOffset, 4);
    heap.get(bytes).data[0] = 29;
    assert.equal(saved.records[bytes.h].data[0], 17);
    heap.restore(saved);
    assert.equal(heap.get(words).data.buffer, heap.get(bytes).data.buffer);
    heap.get(bytes).data[0] = 43;
    assert.equal(new Uint8Array(heap.get(words).data.buffer)[4], 43);
    assert.equal(saved.records[bytes.h].data[0], 17);
  });
}

test('frozen buffer wrappers retain mutable internal bytes and cannot enter the immutable record cache', () => {
  const heap = new ManagedHeap(), buffer = Object.freeze(new ArrayBuffer(4));
  const reference = heap.object('object', [Object.freeze({bytes: buffer})]);
  heap.rootProvider = () => [reference];
  const saved = heap.snapshot();
  new Uint8Array(buffer)[0] = 71;
  const changed = heap.snapshot();
  assert.notEqual(saved.records[reference.h], changed.records[reference.h]);
  heap.restore(saved);
  assert.equal(new Uint8Array(heap.get(reference).data[0].bytes)[0], 0);
  heap.restore(changed);
  assert.equal(new Uint8Array(heap.get(reference).data[0].bytes)[0], 71);
});

test('128 captures with 1% record mutation retain under twice a 10 MiB logical heap', () => {
  const maximum = 64 * 1024 * 1024;
  const heap = new ManagedHeap({maxBytes: maximum, initialThreshold: maximum}), roots = [];
  heap.rootProvider = () => roots;
  for (let index = 0; index < 4096; index++) {
    const text = heap.string(String(index).padStart(6, '0') + 'x'.repeat(1250));
    roots.push(heap.object('object', [text, 0]));
  }
  assert(heap.stats.liveBytes >= 10 * 1024 * 1024);
  const snapshots = [], changed = Math.ceil(heap.stats.liveObjects / 100);
  for (let revision = 0; revision < 128; revision++) {
    for (let index = 0; index < changed; index++) {
      heap.get(roots[(revision * changed + index) % roots.length]).data[1] = revision + 1;
    }
    snapshots.push(heap.snapshot());
  }
  const records = new Set(), generations = new Set();
  let indices = 0;
  for (const snapshot of snapshots) {
    for (const record of snapshot.records) if (record) records.add(record);
    generations.add(snapshot.generations);
    indices += snapshot.records.length * 8;
  }
  const bytes = [...records].reduce((total, record) => total + record.size, indices)
    + [...generations].reduce((total, values) => total + values.length * 8, 0);
  assert(bytes < heap.stats.liveBytes * 2, `retained=${bytes}, heap=${heap.stats.liveBytes}`);
  for (const saved of [snapshots[0], snapshots[63], snapshots[127]]) {
    heap.restore(saved);
    const complete = heap.snapshot({shared: false});
    for (const reference of roots) assert.equal(element(complete.records[reference.h], 1), element(saved.records[reference.h], 1));
  }
});
