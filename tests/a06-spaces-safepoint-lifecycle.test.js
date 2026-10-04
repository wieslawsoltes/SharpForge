import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/heap.js';
import {SafepointCoordinator} from '../packages/runtime/src/gc/safepoints.js';

test('snapshot restores the original safepoint lease after disposal', () => {
  const coordinator = new SafepointCoordinator({});
  const lease = coordinator.register('vm');
  const snapshot = coordinator.snapshot();
  assert.equal(lease.dispose(), true);
  assert.equal(lease.dispose(), false);
  coordinator.restore(snapshot);
  assert.equal(coordinator.contexts.size, 1);
  assert.equal(lease.dispose(), true);
  assert.equal(coordinator.contexts.size, 0);
  assert.equal(lease.dispose(), false);
});

test('a superseded safepoint lease cannot unregister a new context with the same ID', () => {
  const coordinator = new SafepointCoordinator({});
  const first = coordinator.register(7);
  const original = coordinator.snapshot();
  first.dispose();
  const second = coordinator.register(7);
  assert.equal(first.dispose(), false);
  assert.equal(coordinator.contexts.size, 1);
  coordinator.restore(original);
  assert.equal(second.dispose(), false);
  assert.equal(coordinator.contexts.size, 1);
  const ticket = coordinator.request();
  assert.throws(() => first.dispose(), {name: 'InvalidOperationException'});
  coordinator.resume(ticket);
  assert.equal(first.dispose(), true);
});

test('heap snapshot copying preserves the safepoint registration capability identity', () => {
  const heap = new ManagedHeap({maxBytes: 1024 * 1024, initialThreshold: 1024 * 1024});
  const lease = heap.safepoints.register('host');
  const saved = heap.snapshot();
  lease.dispose();
  heap.restore(saved);
  assert.equal(heap.safepoints.contexts.size, 1);
  assert.equal(lease.dispose(), true);
  assert.equal(heap.safepoints.contexts.size, 0);
});
