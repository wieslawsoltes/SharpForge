import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {Op} from '@sharpforge/bytecode';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {sourceArrayBuiltin} from '../packages/runtime/src/execution/source-array-builtins.js';
import {sourceMemoryHandlers} from '../packages/runtime/src/execution/source-ops/memory.js';
import {memoryStackEffect} from '../packages/bytecode/src/memory-stack-effect.js';
import {createArray, arraySet} from '../packages/runtime/src/execution/arrays.js';
import {boxValue} from '../packages/runtime/src/execution/boxing.js';
import {spanGet, spanSet, spanSlice, spanAddress, spanLength} from '../packages/runtime/src/execution/spans.js';

const bridge = (vm, operation, args) => sourceArrayBuiltin(vm, {arrayRuntime: {operation, internal: true}}, args);

function makeVM(engine = 'source') {
  const compiled = compileToIL('class Program { static void Main() { int keep = 0; } }');
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
}

for (const engine of ['source', 'cil']) test(`${engine} string Span bridges preserve UTF-16 ownership and readonly interiors`, () => {
  const vm = makeVM(engine);
  try {
    const reference = vm.heap.string('A\u{1f642}Z');
    const name = vm.heap.string('System.ReadOnlySpan<char>');
    const span = bridge(vm, 'spanFromString', [reference, name]);
    assert.equal(span.pointer.owner, reference);
    assert.equal(spanLength(vm, span), 4);
    assert.equal(spanGet(vm, span, 1), 0xd83d);
    assert.equal(spanGet(vm, span, 2), 0xde42);
    const address = spanAddress(vm, span, 3);
    assert.equal(vm.dereference(address), 90);
    assert.throws(() => vm.dereference(address, true, 33), {name: 'InvalidProgramException'});
    assert.throws(() => spanSet(vm, span, 0, 33), {name: 'InvalidProgramException'});
    assert.throws(() => spanGet(vm, span, 4), {name: 'IndexOutOfRangeException'});
    const empty = spanSlice(vm, span, 4, 0);
    vm.heap.withRoots([empty], () => vm.heap.collect());
    assert.equal(vm.heap.get(reference).data, 'A\u{1f642}Z');
    assert.equal(spanLength(vm, empty), 0);
    const copied = bridge(vm, 'spanToArray', [spanSlice(vm, span, 1, 2)]);
    assert.deepEqual([...vm.heap.get(copied).data], [0xd83d, 0xde42]);
    assert.equal(spanLength(vm, bridge(vm, 'spanFromString', [null, vm.heap.string('System.ReadOnlySpan<char>')])), 0);
    assert.throws(() => bridge(vm, 'spanFromString', [reference, vm.heap.string('System.Span<char>')]),
      {name: 'InvalidProgramException'});
  } finally { vm.stop(); }
});

test('source rectangular element addresses and stack Span addresses use the shared storage paths', () => {
  const vm = makeVM();
  try {
    const type = vm.image.constants.length;
    vm.image.constants.push('int');
    vm.stack.push(2, 3);
    sourceMemoryHandlers[Op.NEWRECT](vm, vm.top, type, 2);
    const matrix = vm.stack.pop();
    vm.stack.push(matrix, 1, 2, 31);
    sourceMemoryHandlers[Op.STRECT](vm, vm.top, 2);
    assert.equal(vm.stack.pop(), 31);
    vm.stack.push(matrix, 1, 2);
    sourceMemoryHandlers[Op.RECTADDR](vm, vm.top, 2);
    const address = vm.stack.pop();
    vm.dereference(address, true, 47);
    assert.equal(vm.heap.get(matrix).data[5], 47);
    vm.stack.push(4);
    sourceMemoryHandlers[Op.STACKALLOC](vm, vm.top, type);
    const span = vm.stack.pop();
    spanSet(vm, span, 1, 29);
    assert.equal(vm.dereference(spanAddress(vm, span, 1)), 29);
    vm.dereference(spanAddress(vm, span, 2), true, 53);
    assert.equal(spanGet(vm, spanSlice(vm, span, 1, 2), 1), 53);
    assert.throws(() => spanGet(vm, span, 4), {name: 'IndexOutOfRangeException'});
  } finally { vm.stop(); }
});

test('source array bridges retain array identity and boxed IndexOf type matching', () => {
  const vm = makeVM();
  try {
    const array = createArray(vm, 'int', [3]);
    arraySet(vm, array, [1], 7);
    const span = bridge(vm, 'spanFromArray', [array, vm.heap.string('System.Span<int>')]);
    spanSet(vm, span, 2, 11);
    assert.equal(vm.heap.get(array).data[2], 11);
    const entry = {arrayRuntime: {owner: 'System.Array', name: 'IndexOf', returnType: 'int',
      parameters: ['System.Array', 'object'], isStatic: true, genericArity: 0}};
    assert.equal(sourceArrayBuiltin(vm, entry, [array, 7], ['int[]', 'int']), 1);
    assert.equal(sourceArrayBuiltin(vm, entry, [array, boxValue(vm, 7, 'int')], ['int[]', 'object']), 1);
    assert.equal(sourceArrayBuiltin(vm, entry, [array, 7n], ['int[]', 'long']), -1);
    assert.equal(sourceArrayBuiltin(vm, entry, [array, null], ['int[]', 'object']), -1);
    assert.throws(() => sourceArrayBuiltin(vm, entry, [null, 7], ['int[]', 'int']), {name: 'ArgumentNullException'});
  } finally { vm.stop(); }
});

test('source memory instruction validation rejects invalid rank, constants, arity and reserved operands', () => {
  const context = {image: {constants: ['int', 'System.Span<int>']}};
  assert.deepEqual(memoryStackEffect(Op.NEWRECT, 0, 2, context), {need: 2, delta: -1, error: null});
  assert.deepEqual(memoryStackEffect(Op.STRECT, 2, 0, context), {need: 4, delta: -3, error: null});
  for (const [op, first, second] of [
    [Op.NEWRECT, 0, 0], [Op.NEWRECT, 0, 33], [Op.NEWRECT, 2, 2], [Op.LDRECT, -1, 0],
    [Op.STRECT, 2, 1], [Op.STACKALLOC, 0, 1], [Op.SPANSLICE, 0, 3], [Op.SPANGET, 1, 0]
  ]) assert.ok(memoryStackEffect(op, first, second, context).error);
  assert.equal(memoryStackEffect(Op.NOP, 0, 0, context), null);
});
