import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryMethodDefinition} from '@sharpforge/cil';
import {ManagedHeap} from '../packages/runtime/src/heap.js';
import {MethodTableRegistry} from '../packages/runtime/src/execution/method-table.js';
import {registerFrame} from '../packages/runtime/src/execution/frame-lifetimes.js';
import {address, dereference} from '../packages/runtime/src/execution/managed-pointers.js';
import {storageValue} from '../packages/runtime/src/execution/storage.js';
import {stackAllocate} from '../packages/runtime/src/execution/stack-memory.js';
import {readMemory, writeMemory, pointerOffset} from '../packages/runtime/src/execution/raw-memory.js';
import {stackSpan, spanCreate, spanFromArray, spanSet, spanGet} from '../packages/runtime/src/execution/spans.js';
import {createArray, arraySet} from '../packages/runtime/src/execution/arrays.js';
import {copyArray, clearArray, indexOfArray, arrayRuntimeCall} from '../packages/runtime/src/execution/array-runtime.js';

function context() {
  const frame = {id: 1, locals: [null], args: [], stack: []};
  const vm = {
    heap: new ManagedHeap({methodTables: new MethodTableRegistry()}), options: {},
    snapshotOwner: Object.freeze({}), frames: [frame], top: frame
  };
  vm.dereference = (pointer, write, value) => dereference(vm, pointer, write, value);
  vm.heap.rootProvider = function* () { yield* frame.locals; yield* frame.stack; };
  registerFrame(vm, frame);
  return vm;
}

test('Span defaults, readonly stores and array covariance retain their boundaries', () => {
  const vm = context();
  assert.equal(spanFromArray(vm, 'int', null).length, 0);
  assert.throws(() => spanFromArray(vm, 'int', null, 1, 0), {name: 'ArgumentOutOfRangeException'});
  const mutable = stackSpan(vm, 'int', 1);
  const readonly = storageValue(vm, mutable, 'System.ReadOnlySpan`1<int>');
  assert.throws(() => spanSet(vm, readonly, 0, 3), {name: 'InvalidProgramException'});
  assert.throws(() => storageValue(vm, readonly, 'System.Span`1<int>'), {name: 'InvalidCastException'});
  assert.throws(() => spanCreate(vm, 'object', mutable.pointer, 1), {name: 'ArgumentException'});
  const strings = createArray(vm, 'string', [1]);
  const text = vm.heap.string('retained');
  arraySet(vm, strings, [0], text);
  const view = spanFromArray(vm, 'object', strings, 0, 1, {readonly: true});
  assert.equal(spanGet(vm, view, 0), text);
  assert.throws(() => spanFromArray(vm, 'object', strings), {name: 'ArrayTypeMismatchException'});
  assert.throws(() => spanFromArray(vm, 'object', strings, 0, 0), {name: 'ArrayTypeMismatchException'});
});

test('raw struct field addresses preserve packed offsets and write back to the region', () => {
  const vm = context();
  vm.heap.methodTables.define({name: 'Pair', base: 'System.ValueType', flags: {valueType: true}, fields: [
    {name: 'A', type: 'int'}, {name: 'B', type: 'short'}
  ]});
  const raw = stackAllocate(vm, 8);
  const pair = storageValue(vm, raw, 'Pair*');
  const field = address(vm, 'field', 1, pair);
  dereference(vm, field, true, 1234);
  assert.equal(readMemory(vm, pointerOffset(vm, raw, 4), 'short'), 1234);
  writeMemory(vm, pointerOffset(vm, raw, 4), -3, 'short');
  assert.equal(dereference(vm, field), -3);
});

test('Array argument errors and equal-length Resize preserve API semantics', () => {
  const vm = context();
  const array = createArray(vm, 'int', [2]);
  vm.top.locals[0] = array;
  assert.throws(() => copyArray(vm, null, 0, array, 0, 0), {name: 'ArgumentNullException'});
  assert.throws(() => clearArray(vm, null), {name: 'ArgumentNullException'});
  assert.throws(() => indexOfArray(vm, null, 0), {name: 'ArgumentNullException'});
  const location = address(vm, 'local', 0, null, {type: 'int[]'});
  const result = arrayRuntimeCall(vm, {
    kind: 'method', owner: 'System.Array', name: 'Resize', methodArguments: ['int'],
    signature: {isStatic: true, parameters: ['!!0[]&', 'int'], returnType: 'void'}
  }, [location, 2]);
  assert.equal(result.handled, true);
  assert.equal(vm.top.locals[0], array);
});

test('BitConverter recognition rejects forged scalar contracts', () => {
  const descriptor = (name, parameters, returnType) => ({
    kind: 'method', owner: 'System.BitConverter', name,
    signature: {isStatic: true, parameters, returnType}
  });
  assert.equal(memoryMethodDefinition(descriptor('DoubleToInt64Bits', ['double'], 'long')).operation, 'bitScalar');
  assert.equal(memoryMethodDefinition(descriptor('DoubleToInt64Bits', ['int'], 'long')), null);
  assert.equal(memoryMethodDefinition(descriptor('ToDouble', ['byte[]', 'int'], 'int')), null);
  assert.equal(memoryMethodDefinition(descriptor('GetBytes', ['object'], 'byte[]')), null);
});
