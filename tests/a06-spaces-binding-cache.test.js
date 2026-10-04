import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/heap.js';
import {copyHeapState} from '../packages/runtime/src/gc/snapshot.js';

function heap() {
  return new ManagedHeap({maxBytes: 1024 * 1024, initialThreshold: 1024 * 1024});
}

function cachedBinding(storage) {
  const symbols = Object.getOwnPropertySymbols(storage);
  assert.equal(symbols.length, 1);
  const descriptor = Object.getOwnPropertyDescriptor(storage, symbols[0]);
  assert.equal(descriptor.enumerable, false);
  assert.equal(descriptor.configurable, false);
  return descriptor.value;
}

test('direct binding metadata stays out of enumerable records and snapshot copies', () => {
  const managed = heap();
  const reference = managed.array('object', 2);
  const record = managed.get(reference);
  const binding = managed.spaces.getBinding(record);
  assert.strictEqual(cachedBinding(record.storage), binding);
  assert.strictEqual(binding.owner, managed.spaces);
  assert.equal(managed.spaces.bindingProperty.value, null);
  const copied = copyHeapState(record.storage);
  assert.equal(Object.getOwnPropertySymbols(copied).length, 0);
  assert.deepEqual(copied, {...record.storage});
  assert.equal(JSON.stringify(copied), JSON.stringify(record.storage));
  const snapshot = managed.snapshot();
  assert.equal(Object.getOwnPropertySymbols(snapshot.records[reference.h].storage).length, 0);
});

test('binding lookup rejects a foreign heap and a descriptor borrowed from another heap', () => {
  const first = heap();
  const second = heap();
  const firstRecord = first.get(first.array('object', 1));
  const secondRecord = second.get(second.array('object', 1));
  assert.throws(() => second.spaces.getBinding(firstRecord), {name: 'InvalidReferenceException'});
  const descriptor = secondRecord.descriptor;
  secondRecord.descriptor = firstRecord.descriptor;
  try {
    assert.throws(() => second.visitEdges(secondRecord, () => {}), {name: 'InvalidReferenceException'});
  } finally {
    secondRecord.descriptor = descriptor;
  }
  const blockId = secondRecord.storage.blockId;
  secondRecord.storage.blockId++;
  assert.throws(() => second.spaces.getBinding(secondRecord), {name: 'InvalidReferenceException'});
  secondRecord.storage.blockId = blockId;
  assert.strictEqual(second.spaces.getBinding(secondRecord).record, secondRecord);
});

test('relocation retains a cache while replacement invalidates the old metadata link', () => {
  const managed = heap();
  managed.object('Slots', [null, 0]);
  const child = managed.object('Slots', []);
  const owner = managed.object('Slots', [child, 17]);
  managed.rootProvider = () => [owner];
  const record = managed.get(owner);
  const before = managed.spaces.getBinding(record);
  const oldStorage = record.storage;
  const offset = before.block.offset;
  managed.collect([], {generation: 2, compacting: true});
  assert.ok(before.block.offset < offset);
  assert.strictEqual(managed.spaces.getBinding(record), before);
  managed.replaceData(owner, [child, 23, null]);
  const after = managed.spaces.getBinding(record);
  assert.notStrictEqual(after, before);
  assert.strictEqual(after.record, record);
  assert.strictEqual(cachedBinding(record.storage), after);
  assert.equal(cachedBinding(oldStorage), null);
  assert.equal(before.block.released, true);
  assert.deepEqual([...record.data], [child, 23, null]);
});

test('restore rebinds copied metadata and releases cached links on superseded records', () => {
  const managed = heap();
  const reference = managed.array('object', 1);
  const original = managed.get(reference);
  const metadata = original.storage;
  const snapshot = managed.snapshot();
  managed.restore(snapshot);
  assert.equal(cachedBinding(metadata), null);
  assert.throws(() => managed.spaces.getBinding(original), {name: 'InvalidReferenceException'});
  const restored = managed.get(reference);
  assert.strictEqual(cachedBinding(restored.storage), managed.spaces.getBinding(restored));
  assert.strictEqual(managed.spaces.getBinding(restored).owner, managed.spaces);
  const currentMetadata = restored.storage;
  managed.collect([], {generation: 2});
  assert.equal(cachedBinding(currentMetadata), null);
  assert.throws(() => managed.spaces.getBinding(restored), {name: 'InvalidReferenceException'});
});

test('failed preparation clears the cache and the reused property descriptor before publication', () => {
  const managed = heap();
  let metadata = null;
  const input = [];
  Object.defineProperty(input, 0, {enumerable: true, get() {
    metadata = managed.spaces.bindings.values().next().value.record.storage;
    return 'invalid numeric input';
  }});
  assert.throws(() => managed.allocate('array', 'int[]', input), /requires a number/);
  assert.ok(metadata);
  assert.equal(cachedBinding(metadata), null);
  assert.equal(managed.spaces.bindingProperty.value, null);
  assert.equal(managed.spaces.bindings.size, 0);
  assert.equal(managed.spaces.arenas.size, 0);
  assert.equal(managed.stats.liveObjects, 0);
  assert.equal(managed.records.length, 0);
});
