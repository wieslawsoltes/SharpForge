import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/index.js';

test('A06 SafeHandle disposal waits for outstanding borrows and releases exactly once', () => {
  const heap = new ManagedHeap();
  const releases = [];
  const resource = {id: 7};
  const handle = heap.lifetime.createSafeHandle(resource, value => { releases.push(value); });
  assert.equal(handle.dangerousAddRef(), true);
  assert.equal(handle.dangerousAddRef(), true);
  assert.equal(handle.close(), true);
  assert.equal(handle.isClosed, true);
  assert.deepEqual(releases, []);
  assert.throws(() => handle.dangerousAddRef(), {name: 'ObjectDisposedException'});
  handle.dangerousRelease();
  assert.deepEqual(releases, []);
  handle.dangerousRelease();
  assert.deepEqual(releases, [resource]);
  assert.equal(handle.close(), false);
  assert.throws(() => handle.dangerousRelease(), {name: 'InvalidOperationException'});
});

test('A06 invalid and borrowed ownership SafeHandles do not release an unowned resource', () => {
  const heap = new ManagedHeap();
  let releases = 0;
  const unowned = heap.lifetime.createSafeHandle(17, () => { releases++; }, {ownsHandle: false});
  const invalid = heap.lifetime.createSafeHandle(0, () => { releases++; }, {invalid: true});
  const revoked = heap.lifetime.createSafeHandle(23, () => { releases++; });
  revoked.setHandleAsInvalid();
  unowned.close();
  invalid.close();
  assert.equal(releases, 0);
  assert.equal(invalid.isInvalid, true);
  assert.equal(revoked.isClosed, true);
});

test('A06 shutdown discards finalizers and attempts all host releases after one release fails', () => {
  const heap = new ManagedHeap();
  const finalizable = heap.object('PendingAtShutdown', []);
  let finalizerCalls = 0;
  heap.lifetime.registerFinalizer(finalizable, () => { finalizerCalls++; });
  heap.collect();
  const pinned = heap.object('PinnedAtShutdown', []);
  const pin = heap.lifetime.pin(pinned);
  heap.createHandle(pinned);
  heap.lifetime.createSafeHandle(1, () => { throw new Error('release failed'); });
  let successfulReleases = 0;
  const resource = heap.lifetime.createSafeHandle(2, () => { successfulReleases++; });
  resource.dangerousAddRef();
  const report = heap.lifetime.shutdown();
  assert.equal(report.discardedFinalizers, 1);
  assert.equal(report.releasedResources, 1);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0].message, /release failed/);
  assert.equal(successfulReleases, 1);
  assert.equal(finalizerCalls, 0);
  assert.equal(heap.lifetime.drainFinalizers().status, 'stopped');
  assert.equal(heap.lifetime.shutdown(), report);
  assert.equal(pin.dispose(), false);
  assert.equal(heap.handles.size, 0);
  assert.throws(() => heap.lifetime.createHandle(pinned), {name: 'InvalidOperationException'});
  assert.throws(() => heap.lifetime.addresses.resolve(pin.address), {name: 'InvalidAddressException'});
});

test('A06 owner teardown attempts all resources and leaves other owners active', () => {
  const heap = new ManagedHeap();
  const closed = [];
  const first = heap.lifetime.createSafeHandle(1, value => { closed.push(value); }, {owner: 'one'});
  const other = heap.lifetime.createSafeHandle(2, value => { closed.push(value); }, {owner: 'two'});
  assert.equal(heap.lifetime.releaseOwner('one').resources, 1);
  assert.equal(first.isClosed, true);
  assert.equal(other.isClosed, false);
  assert.deepEqual(closed, [1]);
});
