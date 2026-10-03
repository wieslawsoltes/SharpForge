import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap, ManagedFault, isReference} from '@sharpforge/runtime';
import {MAX, bclScalar, typeOf, text, string, bounded, integer, array, makeArray, equal, nativeEqual, fail} from '@sharpforge/bcl-core';

function host() {
  const heap = new ManagedHeap();
  return {
    heap,
    bclHost: {isReference, fault(type, message) { throw new ManagedFault(type, message); }},
    native: value => value,
    vm: {format: () => 'managed object'}
  };
}

test('BCL scalar host preserves boxed types, text and null values', () => {
  const platform = host();
  const value = platform.heap.string('text');
  const boxed = platform.heap.allocate('box', 'int', [42]);
  assert.equal(bclScalar(platform, boxed), 42);
  assert.equal(typeOf(platform, boxed), 'int');
  assert.equal(bclScalar(platform, value), 'text');
  assert.equal(typeOf(platform, value), 'string');
  assert.equal(bclScalar(platform, null), null);
  assert.equal(string(platform, null, true), null);
  assert.equal(text(platform, null), '');
  assert.equal(text(platform, true), 'True');
  assert.equal(text(platform, 1, 'System.Boolean'), 'True');
  assert.equal(text(platform, NaN), 'NaN');
  assert.throws(() => string(platform, null), {name: 'ArgumentNullException'});
  assert.throws(() => string(platform, 42), {name: 'ArgumentException'});
});

test('BCL host enforces inclusive range and allocation limits', () => {
  const platform = host();
  assert.equal(integer(platform, 0), 0);
  assert.equal(integer(platform, MAX), MAX);
  for (const value of [-1, MAX + 1, NaN, Infinity, 0.5]) {
    assert.throws(() => integer(platform, value), {name: 'ArgumentOutOfRangeException'});
  }
  assert.equal(bounded(platform, 'x'.repeat(MAX)).length, MAX);
  assert.throws(() => bounded(platform, 'x'.repeat(MAX + 1)), {name: 'OutOfMemoryException'});
  const items = [1, 2];
  const reference = makeArray(platform, 'int', items);
  items[0] = 5;
  assert.deepEqual(array(platform, reference), [1, 2]);
  assert.throws(() => array(platform, platform.heap.string('bad')), {name: 'ArgumentException'});
});

test('BCL equality preserves NaN and generation-qualified references', () => {
  const platform = host();
  assert.equal(equal(platform, NaN, NaN), true);
  const first = platform.heap.object('Custom', []);
  assert.equal(equal(platform, first, {...first}), true);
  assert.equal(equal(platform, first, platform.heap.object('Custom', [])), false);
  const boxed = platform.heap.allocate('box', 'int', [42]);
  assert.equal(equal(platform, boxed, 42), true);
  assert.equal(nativeEqual(platform, boxed, 42), false);
  assert.equal(nativeEqual(platform, boxed, {...boxed}), true);
  platform.heap.collect();
  assert.throws(() => bclScalar(platform, first), {name: 'InvalidReferenceException'});
});

test('BCL host refuses a fault service that silently returns', () => {
  assert.throws(() => fail({bclHost: {fault() {}}}, 'ArgumentException', 'bad'), /must throw/);
});
