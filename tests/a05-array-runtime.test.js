import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/heap.js';
import {MethodTableRegistry} from '../packages/runtime/src/execution/method-table.js';
import {createArray, arraySet, arrayGet, arrayShape} from '../packages/runtime/src/execution/arrays.js';
import {copyArray, clearArray, cloneArray, indexOfArray} from '../packages/runtime/src/execution/array-runtime.js';
import {castReference} from '../packages/runtime/src/execution/casting.js';

function context() {
  return {heap: new ManagedHeap({methodTables: new MethodTableRegistry()}), options: {}, snapshotOwner: Object.freeze({})};
}

test('four million bytes fit a 32MB heap with byte-accurate accounting and Int64 length', () => {
  const vm = context();
  const array = createArray(vm, 'byte', [4_000_000n]);
  assert.ok(vm.heap.get(array).data instanceof Uint8Array);
  assert.equal(vm.heap.get(array).size, 4_000_032);
  assert.throws(() => createArray(vm, 'byte', [-1n]), {name: 'OverflowException'});
  assert.throws(() => createArray(vm, 'byte', [BigInt(vm.heap.maxBytes)]), {name: 'OutOfMemoryException'});
});

test('Array.Copy handles overlap, Clone copies storage, Clear zeroes and IndexOf locates values', () => {
  const vm = context();
  const array = createArray(vm, 'int', [5]);
  for (let index = 0; index < 5; index++) arraySet(vm, array, [index], index + 1);
  copyArray(vm, array, 0, array, 1, 4);
  assert.deepEqual([...vm.heap.get(array).data], [1, 1, 2, 3, 4]);
  const clone = cloneArray(vm, array);
  clearArray(vm, clone, 1, 2);
  assert.deepEqual([...vm.heap.get(clone).data], [1, 0, 0, 3, 4]);
  assert.equal(arrayGet(vm, array, [2]), 2);
  assert.equal(indexOfArray(vm, clone, 3), 3);
  assert.throws(() => copyArray(vm, array, 4, clone, 0, 2), {name: 'ArgumentException'});
});

test('nonzero-bound clones retain rank and covariance supports IEnumerable<object>', () => {
  const vm = context();
  const rectangle = createArray(vm, 'int', [2, 2], [3, -1]);
  arraySet(vm, rectangle, [4, 0], 12);
  const clone = cloneArray(vm, rectangle);
  assert.deepEqual(arrayShape(vm.heap.get(clone)).lowerBounds, [3, -1]);
  assert.equal(arrayGet(vm, clone, [4, 0]), 12);
  const strings = createArray(vm, 'string', [2]);
  assert.equal(castReference(vm.heap, strings, 'System.Collections.Generic.IEnumerable`1<object>'), strings);
  assert.throws(() => arraySet(vm, strings, [0], 123), {name: 'ArrayTypeMismatchException'});
  const integers = createArray(vm, 'int', [1]);
  assert.equal(castReference(vm.heap, integers, 'object[]', false), null);
  const lower = createArray(vm, 'int', [3], [5]);
  assert.throws(() => castReference(vm.heap, lower, 'int[]'), {name: 'InvalidCastException'});
});
