import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/index.js';

test('A06 snapshot replay restores finalizer registration and both weak lifetimes', () => {
  const heap = new ManagedHeap();
  const reference = heap.object('ReplayFinalizer', []);
  let calls = 0;
  heap.lifetime.registerFinalizer(reference, () => { calls++; });
  const short = heap.lifetime.createWeakReference(reference);
  const long = heap.lifetime.createWeakReference(reference, {trackResurrection: true});
  const snapshot = heap.snapshot();
  heap.collect();
  assert.equal(short.target, null);
  heap.lifetime.waitForPendingFinalizers();
  heap.collect();
  assert.equal(long.target, null);
  heap.restore(snapshot);
  assert.equal(short.target, reference);
  assert.equal(long.target, reference);
  heap.collect();
  assert.equal(long.target, reference);
  assert.equal(heap.lifetime.waitForPendingFinalizers().completed, 1);
  assert.equal(calls, 2);
});

test('A06 pin replay revives captured leases without reusing future address or lease identities', () => {
  const heap = new ManagedHeap();
  const reference = heap.array('int', 4);
  const original = heap.lifetime.pin(reference);
  const snapshot = heap.snapshot();
  original.dispose();
  const future = heap.lifetime.pin(reference);
  assert.notEqual(future.address, original.address);
  heap.restore(snapshot);
  assert.equal(heap.get(reference).pinCount, 1);
  assert.equal(heap.lifetime.addressOfPinnedObject(reference), original.address);
  assert.equal(future.dispose(), false);
  assert.throws(() => heap.lifetime.addresses.resolve(future.address), {name: 'InvalidAddressException'});
  assert.equal(original.dispose(), true);
  const replacement = heap.lifetime.pin(reference);
  assert.ok(replacement.id > future.id);
  assert.ok(replacement.address.value > future.address.value);
  replacement.dispose();
});

test('A06 POH address snapshots restore a lifetime pin without introducing a temporary lease', () => {
  const heap = new ManagedHeap();
  const reference = heap.array('byte', 8, {pinned: true});
  const root = heap.createHandle(reference);
  const address = heap.lifetime.addressOfPinnedObject(reference);
  const saved = heap.snapshot();
  heap.releaseHandle(root);
  heap.collect();
  assert.throws(() => heap.lifetime.addresses.resolve(address), {name: 'InvalidAddressException'});
  heap.restore(saved);
  assert.equal(heap.get(reference).pinCount, 0);
  assert.equal(heap.lifetime.pinning.leases.size, 0);
  assert.equal(heap.lifetime.addressOfPinnedObject(reference), address);
  assert.equal(heap.lifetime.addresses.resolve(address).reference, reference);
  heap.releaseHandle(root);
  heap.collect();
  assert.throws(() => heap.lifetime.addresses.resolve(address), {name: 'InvalidAddressException'});
});

test('A06 conditional table snapshots restore entries and invalidate discarded branch wrappers', () => {
  const heap = new ManagedHeap();
  const key = heap.object('Key', []);
  const first = heap.object('FirstValue', []);
  const second = heap.object('SecondValue', []);
  const table = heap.lifetime.createConditionalWeakTable();
  table.add(key, first);
  const snapshot = heap.snapshot();
  table.remove(key);
  table.add(key, second);
  const future = heap.lifetime.createConditionalWeakTable();
  heap.restore(snapshot);
  assert.deepEqual(table.tryGetValue(key), {success: true, value: first});
  assert.throws(() => future.tryGetValue(key), {name: 'InvalidOperationException'});
});

test('A06 cooperative runner snapshots restore instruction progress independently', () => {
  const heap = new ManagedHeap();
  let position = 0;
  const runner = {
    step(budget) {
      const instructions = Math.min(budget, 10 - position);
      position += instructions;
      return {done: position === 10, instructions};
    },
    snapshot() { return {position}; },
    restore(state) { position = state.position; }
  };
  heap.lifetime.registerFinalizer(heap.object('Resumable', []), () => runner);
  heap.collect();
  assert.equal(heap.lifetime.drainFinalizers({budget: 2}).status, 'yielded');
  assert.equal(position, 1);
  const snapshot = heap.snapshot();
  assert.equal(heap.lifetime.drainFinalizers({budget: 20}).completed, 1);
  assert.equal(position, 10);
  heap.restore(snapshot);
  assert.equal(position, 1);
  assert.equal(heap.lifetime.drainFinalizers({budget: 20}).completed, 1);
});

test('A06 active host generator snapshots reject uncloneable execution state', () => {
  const heap = new ManagedHeap();
  heap.lifetime.registerFinalizer(heap.object('Generator', []), function* () {
    yield;
    yield;
  });
  heap.collect();
  heap.lifetime.drainFinalizers({budget: 2});
  assert.throws(() => heap.snapshot(), {name: 'InvalidOperationException'});
});

test('A06 heap restore rejects irreversible native resource release before changing managed records', () => {
  const heap = new ManagedHeap();
  const reference = heap.object('Mutable', [1]);
  const handle = heap.lifetime.createSafeHandle(1, () => {});
  const snapshot = heap.snapshot();
  heap.writeField(reference, 0, 2);
  handle.close();
  assert.throws(() => heap.restore(snapshot), {name: 'InvalidOperationException'});
  assert.equal(heap.get(reference).data[0], 2);
  assert.equal(handle.isClosed, true);
});
