import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/heap.js';
import {MethodTableRegistry} from '../packages/runtime/src/execution/method-table.js';
import {registerFrame, releaseFrame} from '../packages/runtime/src/execution/frame-lifetimes.js';
import {address, dereference} from '../packages/runtime/src/execution/managed-pointers.js';
import {stackAllocate} from '../packages/runtime/src/execution/stack-memory.js';
import {storePinnedLocal, livePinCount} from '../packages/runtime/src/execution/pinned.js';
import {readMemory, writeMemory, pointerOffset, initializeBlock, copyBlock, reinterpretPointer} from '../packages/runtime/src/execution/raw-memory.js';
import {stackSpan, spanGet, spanSet, spanSlice, spanAddress, spanCreate} from '../packages/runtime/src/execution/spans.js';
import {createArray, arrayAddress, arrayGet} from '../packages/runtime/src/execution/arrays.js';

function context() {
  const frame = {id: 1, locals: [0, 0], args: [], stack: []};
  const vm = {
    heap: new ManagedHeap({methodTables: new MethodTableRegistry()}), options: {},
    snapshotOwner: Object.freeze({}), frames: [frame], top: frame
  };
  vm.dereference = (pointer, write, value) => dereference(vm, pointer, write, value);
  vm.heap.rootProvider = function* () { yield* frame.locals; yield* frame.stack; };
  registerFrame(vm, frame);
  return vm;
}

test('stackalloc spans alias slices, bounds check and expire with the frame', () => {
  const vm = context();
  const span = stackSpan(vm, 'int', 4);
  for (let index = 0; index < 4; index++) spanSet(vm, span, index, index + 1);
  const slice = spanSlice(vm, span, 1, 2);
  spanSet(vm, slice, 1, 99);
  assert.equal(spanGet(vm, span, 2), 99);
  assert.throws(() => spanGet(vm, span, 4), {name: 'IndexOutOfRangeException'});
  assert.throws(() => spanSlice(vm, span, 3, 2), {name: 'ArgumentOutOfRangeException'});
  const readonly = spanCreate(vm, 'int', span.pointer, 4, {readonly: true});
  assert.throws(() => dereference(vm, spanAddress(vm, readonly, 0), true, 5), {name: 'InvalidProgramException'});
  releaseFrame(vm, vm.top);
  assert.throws(() => spanGet(vm, span, 0), {name: 'InvalidProgramException'});
});

test('block operations and unaligned reads have exact little-endian byte semantics', () => {
  const vm = context();
  const first = stackAllocate(vm, 16);
  const second = stackAllocate(vm, 16);
  initializeBlock(vm, first, 0xab, 16);
  writeMemory(vm, pointerOffset(vm, first, 1), 0x12345678, 'int');
  assert.equal(readMemory(vm, pointerOffset(vm, first, 1), 'int'), 0x12345678);
  assert.equal(readMemory(vm, pointerOffset(vm, first, 2), 'byte'), 0x56);
  copyBlock(vm, second, first, 16);
  assert.equal(readMemory(vm, pointerOffset(vm, second, 1), 'int'), 0x12345678);
  assert.throws(() => copyBlock(vm, second, first, 17), {name: 'IndexOutOfRangeException'});
  const foreign = context();
  assert.throws(() => readMemory(foreign, first, 'byte'), {name: 'InvalidProgramException'});
  const objects = vm.heap.allocate('array', 'object[]', [null]);
  assert.throws(() => initializeBlock(vm, arrayAddress(vm, objects, [0]), 0, 1), {name: 'NotSupportedException'});
});

test('fixed-style local pin leases keep owners alive and revoke pointers when cleared', () => {
  const vm = context();
  const array = createArray(vm, 'int', [3]);
  const pinned = storePinnedLocal(vm, vm.top, 0, arrayAddress(vm, array, [0]));
  assert.equal(livePinCount(vm), 1);
  vm.heap.collect();
  writeMemory(vm, pointerOffset(vm, pinned, 4), 7, 'int');
  assert.equal(arrayGet(vm, array, [1]), 7);
  storePinnedLocal(vm, vm.top, 0, null);
  assert.equal(livePinCount(vm), 0);
  assert.throws(() => readMemory(vm, pinned, 'int'), {name: 'InvalidProgramException'});
});

test('Unsafe.As on a scalar local reinterprets bits and writes back through the original address', () => {
  const vm = context();
  vm.top.locals[0] = 0x3f800000;
  const integer = address(vm, 'local', 0, null, {type: 'int'});
  const floating = reinterpretPointer(vm, integer, 'int', 'float');
  assert.equal(readMemory(vm, floating).value, 1);
  writeMemory(vm, floating, {float: 'r4', value: 2}, 'float');
  assert.equal(vm.top.locals[0], 0x40000000);
});
