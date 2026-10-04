import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/heap.js';

function heap(options = {}) {
  return new ManagedHeap({maxBytes: 2 * 1024 * 1024, initialThreshold: 2 * 1024 * 1024, arenaSegmentBytes: 4096, ...options});
}

test('managed primitive and reference arrays share compatible indexing through relocatable storage', () => {
  const managed = heap();
  const primitive = managed.array('int', 4);
  managed.get(primitive).data[1] = 42;
  const references = managed.allocate('array', 'object[]', [primitive]);
  managed.rootProvider = () => [references];
  assert.equal(managed.get(primitive).storage.byteLength, 16);
  assert.equal(managed.get(primitive).storage.hostBacked, false);
  assert.equal(managed.get(references).storage.hostBacked, true);
  const result = managed.collect([], {generation: 2, blocking: true, compacting: true});
  assert.equal(result.freedThisCollection, 0);
  assert.deepEqual([...managed.get(primitive).data], [0, 42, 0, 0]);
  assert.deepEqual(managed.get(references).data[0], primitive);
  const supplied = managed.allocate('array', 'int[]', new Int32Array([5, 9]));
  assert.deepEqual([...managed.get(supplied).data], [5, 9]);
});

test('full compaction removes alternating allocation holes and preserves outstanding handles', () => {
  const managed = heap();
  const roots = [];
  managed.rootProvider = () => roots;
  for (let index = 0; index < 24; index++) {
    managed.array('byte', 32 + index % 3 * 16);
    const retained = managed.array('byte', 48 + index % 3 * 16);
    managed.get(retained).data.fill(index);
    roots.push(retained);
  }
  managed.collect([], {generation: 2, compacting: false});
  const fragmented = managed.spaces.memoryInfo().fragmentedBytes;
  assert.ok(fragmented > 0);
  const before = roots.map(reference => ({reference, offset: managed.get(reference).storage.offset}));
  managed.collect([], {generation: 2, blocking: true, compacting: true});
  assert.equal(managed.spaces.memoryInfo().fragmentedBytes, 0);
  assert.ok(before.some(item => managed.get(item.reference).storage.offset < item.offset));
  roots.forEach((reference, index) => assert.equal(managed.get(reference).data.every(value => value === index), true));
  assert.doesNotThrow(() => managed.verify());
});

test('pinned addresses and interior array values survive compaction and snapshot restore', () => {
  const managed = heap();
  managed.array('byte', 64);
  const reference = managed.array('byte', 64);
  managed.get(reference).data[7] = 23;
  const pin = managed.lifetime.pin(reference);
  const token = pin.address;
  const originalOffset = managed.get(reference).storage.offset;
  const snapshot = managed.snapshot();
  managed.collect([], {generation: 2, blocking: true, compacting: true});
  assert.equal(managed.get(reference).storage.offset, originalOffset);
  assert.strictEqual(managed.lifetime.addressOfPinnedObject(reference), token);
  assert.deepEqual(managed.lifetime.addresses.resolve(token).reference, reference);
  managed.get(reference).data[7] = 91;
  managed.restore(snapshot);
  assert.equal(managed.get(reference).data[7], 23);
  assert.equal(managed.get(reference).storage.offset, originalOffset);
  assert.deepEqual(managed.lifetime.addresses.resolve(token).reference, reference);
  pin.dispose();
  assert.throws(() => managed.lifetime.addresses.resolve(token), {name: 'InvalidAddressException'});
});

test('LOH threshold, generation-2 reclamation and best-fit hole reuse are observable', () => {
  const managed = heap({arenaSegmentBytes: 512 * 1024});
  const first = managed.array('byte', 85_000);
  const second = managed.array('byte', 86_000);
  const guard = managed.array('byte', 87_000);
  assert.equal(managed.getGeneration(first), 2);
  assert.equal(managed.get(first).space, 'large');
  const firstLocation = {...managed.get(first).storage};
  managed.rootProvider = () => [second, guard];
  managed.collect([], {generation: 0});
  assert.doesNotThrow(() => managed.get(first));
  managed.collect([], {generation: 2});
  assert.throws(() => managed.get(first), {name: 'InvalidReferenceException'});
  assert.ok(managed.spaces.memoryInfo().large.fragmentedBytes >= 85_000);
  const replacement = managed.array('byte', 85_000);
  assert.equal(managed.get(replacement).storage.arenaId, firstLocation.arenaId);
  assert.equal(managed.get(replacement).storage.offset, firstLocation.offset);
});

test('POH arrays retain their storage location and are accounted separately until a full collection', () => {
  const managed = heap();
  const reference = managed.array('byte', 96, {pinned: true});
  const record = managed.get(reference);
  const original = {...record.storage};
  managed.rootProvider = () => [reference];
  assert.equal(record.space, 'pinned');
  assert.equal(managed.getGeneration(reference), 2);
  assert.ok(managed.spaces.memoryInfo().pinned.liveBytes >= 96);
  managed.collect([], {generation: 2, compacting: true});
  assert.equal(record.storage.arenaId, original.arenaId);
  assert.equal(record.storage.offset, original.offset);
  managed.rootProvider = () => [];
  managed.collect([], {generation: 0});
  assert.doesNotThrow(() => managed.get(reference));
  managed.collect([], {generation: 2});
  assert.equal(managed.spaces.memoryInfo().pinned.objects, 0);
});

test('frozen literals survive with zero root entries and readonly arrays reject collectible edges', () => {
  const managed = heap();
  const references = Array.from({length: 128}, (_, index) => managed.spaces.frozen.string(`literal ${index}`));
  const first = managed.collect([], {generation: 2});
  assert.equal(first.markedObjects, 0);
  assert.equal(first.rootsScanned, 0);
  for (const reference of references) assert.equal(managed.get(reference).space, 'frozen');
  assert.deepEqual(managed.spaces.frozen.string('literal 0'), references[0]);
  const readonly = managed.spaces.frozen.array('byte', [1, 2, 3]);
  assert.throws(() => { managed.get(readonly).data[0] = 4; }, {name: 'InvalidOperationException'});
  const ordinary = managed.array('byte', 1);
  assert.throws(() => managed.spaces.frozen.array('object', [ordinary]), {name: 'ArgumentException'});
  managed.collect([], {generation: 2, compacting: true});
  assert.deepEqual([...managed.get(readonly).data], [1, 2, 3]);
});

test('allocation exhaustion leaves a verifiable heap that can recover after roots are released', () => {
  const managed = heap({maxBytes: 512, initialThreshold: 512, arenaSegmentBytes: 128});
  const roots = [];
  managed.rootProvider = () => roots;
  assert.throws(() => {
    for (let index = 0; index < 20; index++) roots.push(managed.array('byte', 96));
  }, {name: 'OutOfMemoryException'});
  assert.ok(managed.limits.recoveryCollections >= 1);
  assert.doesNotThrow(() => managed.verify());
  roots.length = 0;
  const reference = managed.array('byte', 128);
  roots.push(reference);
  assert.equal(managed.get(reference).data.length, 128);
  assert.doesNotThrow(() => managed.verify());
});
