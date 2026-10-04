import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap, ManagedWeakReference, ManagedConditionalWeakTable} from '../packages/runtime/src/index.js';
import {collectLifetime} from './a06-lifetime-support.js';

for (const mode of ['blocking', 'incremental']) {
  test(`A06 ${mode} short weak clears before finalization and long weak survives f-reachability`, () => {
    const heap = new ManagedHeap();
    const target = heap.object('Finalizable', []);
    const calls = [];
    heap.lifetime.registerFinalizer(target, reference => { calls.push(reference); });
    const short = new ManagedWeakReference(heap, target);
    const long = new ManagedWeakReference(heap, target, {trackResurrection: true});
    collectLifetime(heap, mode);
    assert.deepEqual(calls, []);
    assert.equal(short.target, null);
    assert.equal(long.target, target);
    assert.equal(long.isAlive, true);
    assert.equal(heap.lifetime.drainFinalizers({budget: 64}).pending, 0);
    assert.deepEqual(calls, [target]);
    assert.equal(long.target, target);
    collectLifetime(heap, mode);
    assert.equal(long.target, null);
    assert.deepEqual(long.tryGetTarget(), {success: false, target: null});
  });

  test(`A06 ${mode} ephemeron chains converge without value-to-key self retention`, () => {
    const heap = new ManagedHeap();
    const secondKey = heap.object('Key2', []);
    const secondValue = heap.object('Value2', []);
    const firstKey = heap.object('Key1', []);
    const firstValue = heap.object('Value1', [secondKey]);
    const table = new ManagedConditionalWeakTable(heap);
    table.add(secondKey, secondValue);
    table.add(firstKey, firstValue);
    const root = heap.createHandle(firstKey);
    collectLifetime(heap, mode);
    assert.deepEqual(table.tryGetValue(secondKey), {success: true, value: secondValue});
    const cycleKey = heap.object('CycleKey', []);
    const cycleValue = heap.object('CycleValue', [cycleKey]);
    const cycle = heap.lifetime.createDependentHandle(cycleKey, cycleValue);
    collectLifetime(heap, mode);
    assert.deepEqual(heap.lifetime.getDependentHandle(cycle), {primary: null, secondary: null});
    assert.throws(() => heap.get(cycleValue), {name: 'InvalidReferenceException'});
    heap.releaseHandle(root);
    collectLifetime(heap, mode);
    assert.throws(() => heap.get(firstValue), {name: 'InvalidReferenceException'});
    assert.throws(() => heap.get(secondValue), {name: 'InvalidReferenceException'});
  });

  test(`A06 ${mode} f-reachable keys activate dependent values after short weak processing`, () => {
    const heap = new ManagedHeap();
    const key = heap.object('FinalizableKey', []);
    const value = heap.object('DependentValue', []);
    heap.lifetime.registerFinalizer(key, () => {});
    const dependent = heap.lifetime.createDependentHandle(key, value);
    const short = heap.lifetime.createWeakReference(value);
    const long = heap.lifetime.createWeakReference(value, {trackResurrection: true});
    collectLifetime(heap, mode);
    assert.equal(short.target, null);
    assert.equal(long.target, value);
    assert.equal(heap.lifetime.getDependentHandle(dependent).secondary, value);
    heap.lifetime.waitForPendingFinalizers();
    collectLifetime(heap, mode);
    assert.equal(long.target, null);
    assert.deepEqual(heap.lifetime.getDependentHandle(dependent), {primary: null, secondary: null});
  });
}

test('A06 conditional weak tables reject null/duplicate keys and support reentrant value factories', () => {
  const heap = new ManagedHeap();
  const table = heap.lifetime.createConditionalWeakTable();
  const key = heap.object('Key', []);
  const value = heap.object('Value', []);
  assert.throws(() => table.add(null, value), {name: 'ArgumentNullException'});
  table.add(key, value);
  assert.throws(() => table.add(key, value), {name: 'ArgumentException'});
  assert.equal(table.getValue(key, () => { throw new Error('Factory should not run'); }), value);
  assert.equal(table.remove(key), true);
  assert.equal(table.remove(key), false);
  assert.equal(table.getValue(key, () => { table.add(key, value); return null; }), value);
  assert.equal(table.dispose(), true);
  assert.equal(table.dispose(), false);
  assert.throws(() => table.tryGetValue(key), {name: 'InvalidOperationException'});
});

test('A06 managed table ownership is part of ephemeron reachability', () => {
  const heap = new ManagedHeap();
  const owner = heap.object('TableOwner', []);
  const key = heap.object('Key', []);
  const value = heap.object('Value', []);
  const root = heap.createHandle(key);
  const table = heap.lifetime.createConditionalWeakTable({managedOwner: owner});
  table.add(key, value);
  heap.collect();
  assert.equal(heap.getHandle(root), key);
  assert.throws(() => heap.get(value), {name: 'InvalidReferenceException'});
  assert.equal(heap.stats.hostDependentHandles, 0);
  assert.throws(() => table.tryGetValue(key), {name: 'InvalidOperationException'});
});

test('A06 managed weak wrapper reclamation retires its weak handle', () => {
  const heap = new ManagedHeap();
  const target = heap.object('Target', []);
  const owner = heap.object('WeakOwner', []);
  const weak = heap.lifetime.createWeakReference(target, {managedOwner: owner});
  heap.collect();
  assert.equal(weak.target, null);
  assert.equal(heap.stats.hostWeakHandles, 0);
  assert.equal(weak.dispose(), false);
});
