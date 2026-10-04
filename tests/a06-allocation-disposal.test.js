import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '@sharpforge/runtime';

function assertDisposed(heap) {
  assert.equal(heap.closed, true);
  assert.equal(heap.stats.liveObjects, 0);
  assert.equal(heap.stats.liveBytes, 0);
  assert.equal(heap.pins.length, 0);
  assert.equal(heap.rootRegistry.providers.size, 0);
  assert.equal(heap.events.observerLeases.length, 0);
  assert.equal(heap.events.pendingObservers.length, 0);
  assert.equal(heap.events.observerErrors.length, 0);
}

for (const point of ['finalizer resolver', 'GCCreateSegment', 'GCAllocationTick_V4', 'GCStart_V2']) {
  test(`A06 allocation: disposal in ${point} cannot return or publish a stale allocation`, () => {
    let armed = false;
    let disposed = false;
    const heap = new ManagedHeap({gcStress: point === 'GCStart_V2' ? 'alloc' : false, gcAllocationTickBytes: 1,
      finalizerResolver(reference, record) {
        if (!armed || point !== 'finalizer resolver' || record.type !== 'Disposable') return null;
        disposed = true;
        heap.dispose();
        return () => {};
      },
      onGCEvent(event) {
        if (!armed || event.name !== point || disposed) return;
        disposed = true;
        heap.dispose();
      }});
    const incoming = heap.string('incoming reference');
    heap.pinRoot(incoming);
    armed = true;
    assert.throws(() => heap.object('Disposable', [incoming]), {name: 'ObjectDisposedException'});
    assert.equal(disposed, true);
    assertDisposed(heap);
  });
}

test('A06 allocation: replacement disposal cannot repopulate cleared roots or report success', () => {
  let armed = false;
  let disposed = false;
  const heap = new ManagedHeap({gcStress: false, arenaSegmentBytes: 64,
    onGCEvent(event) {
      if (!armed || event.name !== 'GCCreateSegment' || disposed) return;
      disposed = true;
      heap.dispose();
    }});
  const reference = heap.array('int', 2);
  heap.pinRoot(reference);
  armed = true;
  assert.throws(() => heap.replaceData(reference, Array(64).fill(3)), {name: 'ObjectDisposedException'});
  assert.equal(disposed, true);
  assertDisposed(heap);
});
