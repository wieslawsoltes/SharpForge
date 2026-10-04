import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {Binary, Op} from '@sharpforge/bytecode';
import {VirtualMachine} from '@sharpforge/runtime';
import {sourceUnsafeMemoryHandlers} from '../packages/runtime/src/execution/source-ops/unsafe-memory.js';
import {sourceArithmeticHandlers} from '../packages/runtime/src/execution/source-ops/arithmetic.js';
import {sourcePointerConvert} from '../packages/runtime/src/execution/source-pointer-ops.js';
import {createArray} from '../packages/runtime/src/execution/arrays.js';
import {livePinCount} from '../packages/runtime/src/execution/pinned.js';
import {number} from '../packages/runtime/src/execution/numeric-ops.js';
import {memoryStackEffect} from '../packages/bytecode/src/memory-stack-effect.js';

function fixture(options = {}) {
  const compiled = compileToIL('class Program { static void Main() { int keep = 0; } }');
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const vm = new VirtualMachine(compiled.image, options);
  for (let steps = 0; !vm.image.methods[vm.top.methodId].locals.some(item => item.name === 'keep'); steps++) {
    assert.ok(steps < 32, 'Enter the user method before inspecting its local addresses');
    vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
  }
  const type = vm.image.constants.length;
  vm.image.constants.push('int');
  const method = vm.image.methods[vm.top.methodId], local = method.locals.length;
  method.locals.push({name: '$pin0', type: 'int&', slot: local, hidden: true, pinned: true});
  vm.top.locals.push(null);
  return {vm, type, local};
}

function binary(vm, operation, left, right) {
  vm.stack.push(left, right);
  sourceArithmeticHandlers[Op.BINARY](vm, vm.top, Binary[operation], 0);
  return vm.stack.pop();
}

test('source pin instructions keep primitive arrays alive and revoke every derived pointer on unpin', () => {
  const {vm, type, local} = fixture();
  try {
    const reference = createArray(vm, 'int', [3]);
    vm.stack.push(vm.address('array', 0, reference));
    sourceUnsafeMemoryHandlers[Op.PIN](vm, vm.top, type, local);
    const pointer = vm.stack.pop();
    const second = binary(vm, '+', pointer, 4);
    assert.equal(livePinCount(vm), 1);
    vm.heap.collect();
    vm.dereference(second, true, 71);
    assert.equal(vm.heap.get(reference).data[1], 71);
    assert.equal(binary(vm, '<', pointer, second), true);
    assert.equal(Number(number(binary(vm, '-', second, pointer))), 4);
    assert.throws(() => binary(vm, '+', pointer, 16), {name: 'IndexOutOfRangeException'});
    sourceUnsafeMemoryHandlers[Op.UNPIN](vm, vm.top, local, 0);
    assert.equal(vm.stack.pop(), null);
    assert.equal(livePinCount(vm), 0);
    assert.throws(() => vm.dereference(second), {name: 'InvalidProgramException'});
    assert.throws(() => binary(vm, '==', pointer, second), {name: 'InvalidProgramException'});
  } finally { vm.stop(); }
});

test('separate unsafe conversions of one source local preserve address identity and mutable writeback', () => {
  const {vm} = fixture();
  try {
    const local = vm.image.methods[vm.top.methodId].locals.findIndex(item => item.name === 'keep');
    vm.top.locals[local] = 23;
    const first = sourcePointerConvert(vm, vm.address('local', local), 'int');
    const second = sourcePointerConvert(vm, vm.address('local', local), 'int');
    assert.notEqual(first.source, second.source);
    assert.equal(binary(vm, '==', first, second), true);
    assert.equal(Number(number(binary(vm, '-', first, second))), 0);
    vm.dereference(first, true, 47);
    assert.equal(vm.top.locals[local], 47);
    assert.equal(vm.dereference(second), 47);
    assert.equal(sourcePointerConvert(vm, null, 'int'), null);
    assert.throws(() => sourcePointerConvert(vm, 12, 'int'), {name: 'InvalidProgramException'});
  } finally { vm.stop(); }
});

test('source raw stack allocation checks element size, complete byte bounds and frame lifetime', () => {
  const {vm, type} = fixture({maxStackMemoryBytes: 16});
  try {
    vm.stack.push(4);
    sourceUnsafeMemoryHandlers[Op.STACKALLOC_RAW](vm, vm.top, type, 0);
    const pointer = vm.stack.pop();
    vm.dereference(binary(vm, '+', pointer, 12), true, 101);
    assert.equal(vm.dereference(binary(vm, '+', pointer, 12)), 101);
    sourceUnsafeMemoryHandlers[Op.SIZEOF](vm, vm.top, type, 0);
    assert.equal(vm.stack.pop(), 4);
    vm.stack.push(-1);
    assert.throws(() => sourceUnsafeMemoryHandlers[Op.STACKALLOC_RAW](vm, vm.top, type, 0), {name: 'OverflowException'});
    vm.stack.push(1);
    assert.throws(() => sourceUnsafeMemoryHandlers[Op.STACKALLOC_RAW](vm, vm.top, type, 0), {name: 'StackOverflowException'});
    vm.stop();
    assert.throws(() => vm.dereference(pointer), {name: 'InvalidProgramException'});
  } finally { vm.stop(); }
});

test('native source bytecode pin effects require declared pinned byref slots', () => {
  const image = {constants: ['int']};
  const method = {locals: [{type: 'int&', pinned: true}, {type: 'int&'}, {type: 'int', pinned: true}]};
  const context = {image, method};
  assert.equal(memoryStackEffect(Op.PIN, 0, 0, context).error, null);
  assert.equal(memoryStackEffect(Op.UNPIN, 0, 0, context).error, null);
  assert.ok(memoryStackEffect(Op.PIN, 0, 1, context).error);
  assert.ok(memoryStackEffect(Op.PIN, 0, 2, context).error);
  assert.ok(memoryStackEffect(Op.UNPIN, 0, 1, context).error);
  assert.ok(memoryStackEffect(Op.PTRCONVERT, 1, 0, context).error);
  assert.deepEqual(memoryStackEffect(Op.SIZEOF, 0, 0, context), {need: 0, delta: 1, error: null});
});
