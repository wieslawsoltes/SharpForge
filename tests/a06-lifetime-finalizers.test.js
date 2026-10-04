import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/index.js';
import {collectLifetime} from './a06-lifetime-support.js';

for (const mode of ['blocking', 'incremental']) {
  test(`A06 ${mode} finalizer registration preserves one complete f-reachable graph`, () => {
    const calls = [];
    const heap = new ManagedHeap({finalizerResolver: (reference, record) => record.type === 'Automatic' ?
      () => { calls.push(reference); } : null});
    const child = heap.object('Child', []);
    const reference = heap.object('Automatic', [child]);
    collectLifetime(heap, mode);
    assert.deepEqual(calls, []);
    assert.equal(heap.get(reference).data[0], child);
    assert.equal(heap.get(child).type, 'Child');
    assert.equal(heap.lifetime.drainFinalizers({budget: 8}).completed, 1);
    assert.deepEqual(calls, [reference]);
    collectLifetime(heap, mode);
    assert.throws(() => heap.get(reference), {name: 'InvalidReferenceException'});
    assert.throws(() => heap.get(child), {name: 'InvalidReferenceException'});
    assert.equal(heap.lifetime.drainFinalizers({budget: 8}).completed, 0);
  });

  test(`A06 ${mode} suppression, re-registration and resurrection preserve object identity`, () => {
    const heap = new ManagedHeap();
    const reference = heap.object('Resurrecting', [7]);
    let count = 0;
    let resurrected = null;
    heap.lifetime.registerFinalizer(reference, value => {
      count++;
      if (count === 1) {
        resurrected = heap.createHandle(value);
        heap.lifetime.reRegisterForFinalize(value);
      }
    });
    heap.lifetime.suppressFinalize(reference);
    const initialRoot = heap.createHandle(reference);
    collectLifetime(heap, mode);
    assert.equal(heap.lifetime.drainFinalizers().completed, 0);
    heap.lifetime.reRegisterForFinalize(reference);
    heap.releaseHandle(initialRoot);
    collectLifetime(heap, mode);
    heap.lifetime.waitForPendingFinalizers();
    assert.equal(count, 1);
    assert.equal(heap.get(heap.getHandle(resurrected)).data[0], 7);
    collectLifetime(heap, mode);
    assert.equal(heap.lifetime.drainFinalizers().completed, 0);
    heap.releaseHandle(resurrected);
    collectLifetime(heap, mode);
    heap.lifetime.waitForPendingFinalizers();
    assert.equal(count, 2);
    collectLifetime(heap, mode);
    assert.throws(() => heap.get(reference), {name: 'InvalidReferenceException'});
  });
}

test('A06 queued suppression does not execute a discarded finalizer', () => {
  const heap = new ManagedHeap();
  const reference = heap.object('Disposable', []);
  let calls = 0;
  heap.lifetime.registerFinalizer(reference, () => { calls++; });
  heap.collect();
  assert.equal(heap.lifetime.finalizers.pendingCount, 1);
  assert.equal(heap.lifetime.suppressFinalize(reference), true);
  assert.equal(heap.lifetime.finalizers.pendingCount, 0);
  assert.equal(heap.lifetime.drainFinalizers().completed, 0);
  heap.collect();
  assert.equal(calls, 0);
  assert.throws(() => heap.get(reference), {name: 'InvalidReferenceException'});
});

test('A06 host finalizer callbacks discard ordinary return values and release f-reachable roots', () => {
  const heap = new ManagedHeap();
  const calls = [];
  const weak = [];
  for (const result of [42, false, 'ignored', {ignored: true}]) {
    const reference = heap.object('HostFinalizer', []);
    weak.push(heap.lifetime.createWeakReference(reference, {trackResurrection: true}));
    heap.lifetime.registerFinalizer(reference, () => {
      calls.push(result);
      return result;
    });
  }
  heap.collect();
  const drained = heap.lifetime.drainFinalizers();
  assert.equal(drained.fault, null);
  assert.equal(drained.completed, 4);
  assert.equal(drained.pending, 0);
  assert.equal(calls.length, 4);
  heap.collect();
  assert.deepEqual(weak.map(value => value.target), [null, null, null, null]);
});

test('A06 asynchronous host finalizer results still reject unsupported Promise execution', () => {
  const heap = new ManagedHeap();
  const reference = heap.object('AsyncFinalizer', []);
  heap.lifetime.registerFinalizer(reference, () => Promise.resolve());
  heap.collect();
  const result = heap.lifetime.drainFinalizers();
  assert.equal(result.status, 'faulted');
  assert.equal(result.fault.name, 'NotSupportedException');
  assert.equal(result.fault.fatal, true);
  assert.equal(result.completed, 0);
});

test('A06 all normal finalizers precede critical finalizers in the same discovery cycle', () => {
  const heap = new ManagedHeap();
  const criticalReference = heap.object('CriticalResource', []);
  const normalReference = heap.object('NormalOwner', [criticalReference]);
  const events = [];
  const resource = heap.lifetime.createSafeHandle({open: true}, value => {
    value.open = false;
    events.push('critical');
  }, {reference: criticalReference});
  heap.lifetime.registerFinalizer(normalReference, () => {
    assert.equal(resource.isClosed, false);
    assert.equal(resource.dangerousGetHandle().open, true);
    events.push('normal');
  });
  heap.collect();
  assert.equal(heap.lifetime.finalizers.pendingCount, 2);
  heap.lifetime.waitForPendingFinalizers();
  assert.deepEqual(events, ['normal', 'critical']);
  assert.equal(resource.isClosed, true);
  assert.equal(resource.close(), false);
});

test('A06 cooperative finalizers yield with bounded progress and fault infinite execution', () => {
  const heap = new ManagedHeap({maxFinalizerInstructions: 32, finalizerSliceBudget: 4});
  const reference = heap.object('LoopingFinalizer', []);
  let progress = 0;
  heap.lifetime.registerFinalizer(reference, function* () {
    while (true) {
      progress++;
      yield;
    }
  });
  heap.collect();
  assert.equal(progress, 0);
  const first = heap.lifetime.drainFinalizers();
  assert.equal(first.status, 'yielded');
  assert.ok(progress <= 4);
  const normalWork = heap.object('MainContextStillRuns', []);
  assert.equal(heap.get(normalWork).type, 'MainContextStillRuns');
  let result = first;
  for (let slice = 0; slice < 10 && !result.fault; slice++) result = heap.lifetime.drainFinalizers();
  assert.equal(result.status, 'faulted');
  assert.equal(result.fault.name, 'ExecutionLimitException');
  assert.equal(result.fault.fatal, true);
  assert.ok(progress <= 31);
  assert.throws(() => heap.lifetime.waitForPendingFinalizers(), {name: 'ExecutionLimitException'});
});

test('A06 unhandled finalizer failure terminates the finalizer context and is reported once', () => {
  const faults = [];
  const heap = new ManagedHeap({onFinalizerFault: fault => { faults.push(fault); }});
  const bad = heap.object('BadFinalizer', []);
  const pending = heap.object('PendingFinalizer', []);
  let laterCalls = 0;
  heap.lifetime.registerFinalizer(bad, () => { throw new Error('unhandled'); });
  heap.lifetime.registerFinalizer(pending, () => { laterCalls++; });
  heap.collect();
  const result = heap.lifetime.drainFinalizers();
  assert.equal(result.fault.name, 'UnhandledFinalizerException');
  assert.match(result.fault.message, /unhandled/);
  assert.equal(result.fault.finalizerReference, bad);
  heap.lifetime.drainFinalizers();
  assert.equal(faults.length, 1);
  assert.equal(laterCalls, 0);
});

test('A06 finalizer wait drains all queued work and rejects invalid budgets', () => {
  const heap = new ManagedHeap();
  let calls = 0;
  for (let index = 0; index < 20; index++) {
    heap.lifetime.registerFinalizer(heap.object('Finalizer', []), () => { calls++; });
  }
  heap.collect();
  assert.throws(() => heap.lifetime.drainFinalizers({budget: 0}), RangeError);
  assert.throws(() => heap.lifetime.drainFinalizers({budget: NaN}), RangeError);
  const result = heap.lifetime.waitForPendingFinalizers();
  assert.equal(result.pending, 0);
  assert.equal(calls, 20);
});

test('A06 finalizer waiting from inside a finalizer cannot wait on itself', () => {
  const heap = new ManagedHeap();
  let entered = false;
  heap.lifetime.registerFinalizer(heap.object('ReentrantWait', []), () => {
    entered = true;
    assert.equal(heap.lifetime.waitForPendingFinalizers().pending, 1);
  });
  heap.collect();
  assert.equal(heap.lifetime.waitForPendingFinalizers().pending, 0);
  assert.equal(entered, true);
});
