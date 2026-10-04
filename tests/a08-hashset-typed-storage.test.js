import test from 'node:test';
import assert from 'node:assert/strict';
import {createCapacityHost, capacityState} from './helpers/hashset-capacity.js';

for (const engine of ['source', 'cil']) {
  test(`SF-A08-T13 ${engine}: capacity growth preserves typed markers, holes and captured storage`, () => {
    const host = createCapacityHost(engine, {constructor: {kind: 'capacity', capacity: 7}});
    const {vm, platform, reference} = host;
    const heap = platform.heap;
    const previousObserver = heap.allocationObserver;
    try {
      for (const value of [10, 20, 30]) host.call('Add', value);
      host.call('Remove', 20);
      const oldReference = platform.get(reference, '$slots');
      const oldMarkers = heap.get(oldReference).data;
      assert(oldMarkers instanceof Int32Array);
      const expectedMarkers = [...oldMarkers];
      const snapshot = vm.snapshot();
      let notifications = 0;
      heap.allocationObserver = {allocation(_bytes, growth) {
        if (growth) return;
        notifications++;
        heap.collect();
        assert.deepEqual([...oldMarkers], expectedMarkers, 'preparing replacement leaves old markers unchanged');
        assert.deepEqual(capacityState(host), {capacity: 7, count: 2, values: [10, 30]},
          'allocation observers see the original complete tuple until publication');
      }};
      assert.equal(host.call('EnsureCapacity', 37), 37);
      heap.allocationObserver = previousObserver;
      assert.equal(notifications, 2);
      const record = heap.get(platform.get(reference, '$slots'));
      assert(record.data instanceof Int32Array);
      assert.equal(record.size, 32 + 37 * Int32Array.BYTES_PER_ELEMENT);
      assert.deepEqual([...record.data.slice(0, 7)], expectedMarkers);
      assert(record.data.subarray(7).every(value => value === -1));
      assert.equal(heap.pins.length, 0);
      const allocations = heap.stats.allocations;
      assert.equal(host.call('EnsureCapacity', 37), 37);
      assert.equal(heap.stats.allocations, allocations, 'already sufficient capacity allocates no storage');
      host.call('Add', 40);
      assert.deepEqual(capacityState(host), {capacity: 37, count: 3, values: [10, 40, 30]});
      vm.restore(snapshot);
      assert.deepEqual(capacityState(host), {capacity: 7, count: 2, values: [10, 30]});
      const restored = heap.get(platform.get(reference, '$slots'));
      assert(restored.data instanceof Int32Array);
      assert.deepEqual([...restored.data], expectedMarkers);
      assert.equal(host.call('EnsureCapacity', 37), 37);
      host.call('Add', 40);
      assert.deepEqual(capacityState(host), {capacity: 37, count: 3, values: [10, 40, 30]});
      assert.equal(heap.pins.length, 0);
    } finally { heap.allocationObserver = previousObserver; host.stop(); }
  });
}
