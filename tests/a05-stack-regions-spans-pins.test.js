import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';
import {createArray, arrayAddress, arrayGet} from '../packages/runtime/src/execution/arrays.js';
import {stackAllocate} from '../packages/runtime/src/execution/stack-memory.js';
import {stackSpan, spanSet, spanGet, spanSlice, spanFromArray, spanAddress, spanLength} from '../packages/runtime/src/execution/spans.js';
import {pointerOffset, readMemory, writeMemory, copyBlock, initializeBlock, reinterpretPointer} from '../packages/runtime/src/execution/raw-memory.js';
import {storePinnedLocal, pinnedAddress, livePinCount} from '../packages/runtime/src/execution/pinned.js';
import {boxValue} from '../packages/runtime/src/execution/boxing.js';

function fixture(body = writer => writer.op('ret'), locals = ['object']) {
  return genericCallFixture([{name: 'Program', methods: [{name: 'Main', locals, body}]}]);
}

test('frame-owned Span<int> supports initializer stores, slices and revokes all aliases on return', () => {
  const vm = new CilVirtualMachine(fixture());
  const span = stackSpan(vm, 'int', 4);
  try {
    for (let index = 0; index < 4; index++) spanSet(vm, span, index, index + 1);
    const slice = spanSlice(vm, span, 1, 2);
    spanSet(vm, slice, 0, 17);
    assert.equal(spanGet(vm, span, 1), 17);
    assert.equal(spanGet(vm, slice, 1), 3);
    assert.throws(() => spanGet(vm, span, 4), {name: 'IndexOutOfRangeException'});
    assert.throws(() => spanSlice(vm, span, 3, 2), {name: 'ArgumentOutOfRangeException'});
    vm.run();
    assert.throws(() => spanGet(vm, span, 0), {name: 'InvalidProgramException'});
    assert.throws(() => spanGet(vm, slice, 0), {name: 'InvalidProgramException'});
  } finally { vm.stop(); }
});

test('raw blocks preserve byte offsets, unaligned little-endian scalar values and overlap semantics', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const pointer = stackAllocate(vm, 16);
    writeMemory(vm, pointerOffset(vm, pointer, 1), 0x11223344, 'int');
    assert.equal(readMemory(vm, pointerOffset(vm, pointer, 1), 'int'), 0x11223344);
    assert.equal(readMemory(vm, pointerOffset(vm, pointer, 2), 'byte'), 0x33);
    copyBlock(vm, pointerOffset(vm, pointer, 2), pointerOffset(vm, pointer, 1), 4);
    assert.equal(readMemory(vm, pointerOffset(vm, pointer, 2), 'int'), 0x11223344);
    initializeBlock(vm, pointerOffset(vm, pointer, 8), 0xff, 4);
    assert.equal(readMemory(vm, pointerOffset(vm, pointer, 8), 'int'), -1);
    assert.throws(() => readMemory(vm, pointerOffset(vm, pointer, 14), 'int'), {name: 'IndexOutOfRangeException'});
    assert.throws(() => initializeBlock(vm, pointer, 0, -1), {name: 'IndexOutOfRangeException'});
    const before = readMemory(vm, pointer, 'int');
    assert.throws(() => writeMemory(vm, pointer, vm.heap.string('invalid'), 'int'), {name: 'InvalidProgramException'});
    assert.equal(readMemory(vm, pointer, 'int'), before);
  } finally { vm.stop(); }
});

test('reinterpretation of a mutable managed local preserves writeback and a Boolean readonly flag', () => {
  const vm = new CilVirtualMachine(fixture(writer => writer.op('ret'), ['int']));
  try {
    const location = vm.address('local', 0);
    vm.dereference(location, true, 0x3f800000);
    const pointer = reinterpretPointer(vm, location, 'int', 'float');
    assert.equal(pointer.readonly, false);
    assert.equal(readMemory(vm, pointer).value, 1);
    writeMemory(vm, pointer, vm.storage(2, 'float'));
    assert.equal(vm.top.locals[0], 0x40000000);
  } finally { vm.stop(); }
});

test('pins root owners across GC, support pointer arithmetic, and clearing the pin revokes every derived pointer', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const array = createArray(vm, 'int', [4]);
    const pin = storePinnedLocal(vm, vm.top, 0, arrayAddress(vm, array, [0]));
    vm.top.locals[0] = pin;
    const second = pointerOffset(vm, pin, 4, 'int');
    writeMemory(vm, second, 7, 'int');
    vm.heap.collect();
    assert.equal(arrayGet(vm, array, [1]), 7);
    assert.equal(livePinCount(vm), 1);
    assert.equal(vm.heap.stats.hostStrongHandles, 1);
    assert.throws(() => storePinnedLocal(vm, vm.top, 0, vm.heap.string('bad')), {name: 'NotSupportedException'});
    assert.equal(readMemory(vm, second, 'int'), 7);
    vm.top.locals[0] = storePinnedLocal(vm, vm.top, 0, null);
    assert.equal(livePinCount(vm), 0);
    assert.equal(vm.heap.stats.hostStrongHandles, 0);
    assert.throws(() => readMemory(vm, second, 'int'), {name: 'InvalidProgramException'});
    vm.heap.collect();
    assert.throws(() => vm.heap.get(array), {name: 'InvalidReferenceException'});
  } finally { vm.stop(); }
});

test('fixed array locals resolve lexical pin leases and stop disposes their host roots', () => {
  const vm = new CilVirtualMachine(fixture());
  const array = createArray(vm, 'int', [2]);
  vm.top.locals[0] = storePinnedLocal(vm, vm.top, 0, array);
  const pointer = pinnedAddress(vm, arrayAddress(vm, array, [1]));
  writeMemory(vm, pointer, 31, 'int');
  assert.equal(arrayGet(vm, array, [1]), 31);
  vm.stop();
  assert.equal(vm.heap.stats.hostStrongHandles, 0);
  assert.throws(() => readMemory(vm, pointer, 'int'), {name: 'InvalidProgramException'});
});

test('reference-containing memory is never reinterpreted and read-only spans preserve their owner', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const array = createArray(vm, 'string', [1]);
    vm.top.locals[0] = spanFromArray(vm, 'object', array, 0, 1, {readonly: true});
    const span = vm.top.locals[0];
    assert.equal(spanGet(vm, span, 0), null);
    assert.throws(() => spanSet(vm, span, 0, null), {name: 'InvalidProgramException'});
    assert.throws(() => reinterpretPointer(vm, spanAddress(vm, span, 0), 'object', 'long'), {name: 'NotSupportedException'});
    assert.throws(() => boxValue(vm, span, 'System.ReadOnlySpan`1<object>'), {name: 'InvalidProgramException'});
    const empty = spanSlice(vm, span, 1, 0);
    vm.top.locals[0] = empty;
    vm.heap.collect();
    assert.equal(spanLength(vm, empty), 0);
    assert.equal(vm.heap.get(array).kind, 'array');
  } finally { vm.stop(); }
});

test('stack memory respects explicit byte limits and rejects foreign region capabilities', () => {
  const vm = new CilVirtualMachine(fixture(), {maxStackMemoryBytes: 8}), other = new CilVirtualMachine(fixture());
  try {
    const pointer = stackAllocate(vm, 8);
    assert.throws(() => stackAllocate(vm, 1), {name: 'StackOverflowException', fatal: true});
    assert.throws(() => readMemory(other, pointer, 'byte'), {name: 'InvalidProgramException'});
    assert.throws(() => stackAllocate(vm, -1), {name: 'OverflowException'});
  } finally { vm.stop(); other.stop(); }
});

test('actual CIL localloc and unaligned block/scalar handlers share little-endian storage', () => {
  const bytes = fixture((writer, context) => {
    const print = context.member('System.Console', 'WriteLine', 'void', ['int']);
    writer.op('ldc.i4.s', 16).op('conv.u').op('localloc').op('stloc.0');
    writer.op('ldloc.0').op('ldc.i4.1').op('add').op('ldc.i4', 0x11223344).op('unaligned.', 1).op('stind.i4');
    writer.op('ldloc.0').op('ldc.i4.1').op('add').op('unaligned.', 1).op('ldind.i4').op('call', print);
    writer.op('ldloc.0').op('ldc.i4', 255).op('ldc.i4.4').op('initblk');
    writer.op('ldloc.0').op('ldind.i4').op('call', print).op('ret');
  }, ['int*']);
  const vm = new CilVirtualMachine(bytes);
  try { assert.equal(vm.run().output, '287454020\n-1\n'); }
  finally { vm.stop(); }
});
