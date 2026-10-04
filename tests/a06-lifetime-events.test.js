import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/index.js';

test('A06 pin events report real counted acquire and release transitions', () => {
  const heap = new ManagedHeap();
  const reference = heap.object('Pinned', []);
  const first = heap.lifetime.pin(reference);
  const second = heap.lifetime.pin(reference);
  first.dispose();
  second.dispose();
  const events = heap.events.read().events.filter(event => event.name === 'PinObjectAtGCTime');
  assert.deepEqual(events.map(event => [event.action, event.pinCount]), [['pin', 1], ['pin', 2], ['unpin', 1], ['unpin', 0]]);
  assert.ok(events.every(event => event.objectId === `${reference.h}:${reference.g}`));
});

test('A06 finalizer events bracket actual cooperative work and report a fatal ending', () => {
  const heap = new ManagedHeap();
  heap.lifetime.drainFinalizers();
  assert.equal(heap.events.read().events.filter(event => event.name.startsWith('GCFinalizers')).length, 0);
  heap.lifetime.registerFinalizer(heap.object('Finalizer', []), () => { throw new Error('failure'); });
  heap.collect();
  heap.lifetime.drainFinalizers();
  const events = heap.events.read().events.filter(event => event.name.startsWith('GCFinalizers'));
  assert.deepEqual(events.map(event => event.name), ['GCFinalizersBegin', 'GCFinalizersEnd']);
  assert.equal(events[0].pending, 1);
  assert.equal(events[1].status, 'faulted');
  assert.equal(events[1].completed, 0);
});

test('A06 actual native buffers hold memory pressure until the last SafeHandle borrow releases', () => {
  const heap = new ManagedHeap({memoryPressureBudget: 32});
  const before = heap.stats.collections;
  const buffer = new Uint8Array(64);
  const handle = heap.lifetime.createSafeHandle(buffer, () => {});
  assert.equal(heap.pressure.bytes, 64n);
  assert.ok(heap.stats.collections > before);
  handle.dangerousAddRef();
  handle.close();
  assert.equal(heap.pressure.bytes, 64n);
  handle.dangerousRelease();
  assert.equal(heap.pressure.bytes, 0n);
  handle.close();
  assert.equal(heap.pressure.removedBytes, 64n);
});

test('A06 explicit native pressure balances teardown and rejects invalid size declarations', () => {
  const heap = new ManagedHeap();
  heap.lifetime.createSafeHandle({nativeId: 1}, () => {}, {owner: 'buffer-owner', memoryPressureBytes: 128n});
  assert.equal(heap.lifetime.releaseOwner('buffer-owner').resources, 1);
  assert.equal(heap.pressure.bytes, 0n);
  assert.throws(() => heap.lifetime.createSafeHandle({}, () => {}, {memoryPressureBytes: -1}),
    {name: 'ArgumentOutOfRangeException'});
  assert.throws(() => heap.lifetime.createSafeHandle({}, () => {}, {memoryPressureBytes: Number.MAX_SAFE_INTEGER + 1}),
    {name: 'ArgumentOutOfRangeException'});
});
