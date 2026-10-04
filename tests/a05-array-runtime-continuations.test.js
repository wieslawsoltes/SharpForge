import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {TEXT_RVA} from '@sharpforge/cil';
import {genericCallFixture} from './support/generic-call-fixture.js';
import {createArray, arrayGet, arraySet, arrayShape} from '../packages/runtime/src/execution/arrays.js';
import {copyArray, clearArray, cloneArray, fillArray, indexOfArray} from '../packages/runtime/src/execution/array-runtime.js';
import {validateArrayContinuation} from '../packages/runtime/src/execution/array-continuations.js';

function fixture() {
  return genericCallFixture([{name: 'Program', methods: [{name: 'Main', locals: ['object'], body: writer => writer.op('ret')}]}]);
}

test('array transfers preserve overlap, primitive widening, boxed identity and complete preflight ranges', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const source = createArray(vm, 'int', [5]);
    vm.top.locals[0] = source;
    for (let index = 0; index < 5; index++) arraySet(vm, source, [index], index + 1);
    copyArray(vm, source, source, {sourceIndex: 0, destinationIndex: 1, length: 4});
    assert.deepEqual([...vm.heap.get(source).data], [1, 1, 2, 3, 4]);
    copyArray(vm, source, source, {sourceIndex: 1, destinationIndex: 0, length: 4});
    assert.deepEqual([...vm.heap.get(source).data], [1, 2, 3, 4, 4]);
    const wider = createArray(vm, 'long', [5]);
    copyArray(vm, source, wider);
    assert.deepEqual([...vm.heap.get(wider).data], [1n, 2n, 3n, 4n, 4n]);
    const objects = createArray(vm, 'object', [5]);
    copyArray(vm, source, objects);
    assert.equal(vm.heap.get(vm.heap.get(objects).data[2]).methodTable.name, 'System.Int32');
    const restored = createArray(vm, 'int', [5]);
    copyArray(vm, objects, restored);
    assert.deepEqual([...vm.heap.get(restored).data], [1, 2, 3, 4, 4]);
    assert.throws(() => copyArray(vm, source, restored, {length: 6}), {name: 'ArgumentException'});
    assert.deepEqual([...vm.heap.get(restored).data], [1, 2, 3, 4, 4]);
    assert.throws(() => copyArray(vm, wider, restored), {name: 'ArrayTypeMismatchException'});
    assert.throws(() => clearArray(vm, null), {name: 'ArgumentNullException'});
  } finally { vm.stop(); }
});

test('Clone retains multidimensional lower bounds while Clear and IndexOf share typed Boolean/NaN semantics', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const matrix = createArray(vm, 'int', [2, 2], [3, -1]);
    arraySet(vm, matrix, [4, 0], 7);
    const clone = cloneArray(vm, matrix);
    assert.deepEqual(arrayShape(vm.heap.get(clone)).lowerBounds, [3, -1]);
    assert.equal(arrayGet(vm, clone, [4, 0]), 7);
    clearArray(vm, clone);
    assert.equal(arrayGet(vm, matrix, [4, 0]), 7);
    assert.equal(arrayGet(vm, clone, [4, 0]), 0);
    const booleans = createArray(vm, 'bool', [4]);
    fillArray(vm, booleans, 1, {start: 1, length: 2});
    assert.equal(indexOfArray(vm, booleans, 1), 1);
    clearArray(vm, booleans, {start: 1, length: 1});
    assert.equal(indexOfArray(vm, booleans, 1), 2);
    const numbers = createArray(vm, 'double', [2]);
    arraySet(vm, numbers, [1], vm.storage(NaN, 'double'));
    assert.equal(indexOfArray(vm, numbers, vm.storage(NaN, 'double')), 1);
  } finally { vm.stop(); }
});

function startContinuation(vm, operation) {
  for (let attempt = 0; attempt < 200 && vm.top?.intrinsicContinuation?.operation !== operation; attempt++) {
    vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
  }
  assert.equal(vm.top?.intrinsicContinuation?.operation, operation, vm.fault?.message);
  return vm.top;
}

for (const engine of ['source', 'cil']) test(`${engine} sort work obeys one-unit slices, GC roots and replay without advancing the caller`, () => {
  const compiled = compileToIL(`using System; class Program { static void Main() {
    int[] values = new int[256]; Array.Sort(values);
    Console.WriteLine(values[0]); Console.WriteLine(values[255]);
  } }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
  try {
    const frame = startContinuation(vm, 'Sort');
    const reference = frame.intrinsicContinuation.destination;
    const data = vm.heap.get(reference).data;
    for (let index = 0; index < data.length; index++) data[index] = data.length - index - 1;
    const pc = frame.pc, instructions = vm.instructions;
    vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
    assert.equal(vm.instructions, instructions + 1);
    assert.equal(frame.pc, pc);
    assert.equal(frame.intrinsicContinuation.work, 1);
    validateArrayContinuation(vm, frame);
    const snapshot = vm.snapshot();
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      vm.heap.collect();
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '0\n255\n');
      assert.equal(vm.heap.get(reference).data[255], 255);
    }
  } finally { vm.stop(); }
});

for (const engine of ['source', 'cil']) test(`${engine} bulk Copy/Clear operations suspend and fault on instruction exhaustion`, () => {
  const compiled = compileToIL(`using System; class Program { static void Main() {
    int[] first = new int[4096]; int[] second = new int[4096];
    Array.Copy(first, second, 4096); Array.Clear(second, 0, 4096); Console.WriteLine(1);
  } }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
  try {
    const frame = startContinuation(vm, 'Copy');
    vm.options.maxInstructions = vm.instructions + 2;
    vm.run();
    assert.equal(vm.state, 'faulted');
    assert.equal(vm.fault.name, 'InstructionLimitException');
    assert.equal(vm.output.join(''), '');
    assert.equal(frame.intrinsicContinuation, undefined);
  } finally { vm.stop(); }
});

function initializerFixture() {
  return genericCallFixture([
    {name: 'Bytes', base: 'System.ValueType', flags: 0x100111, fields: [], methods: []},
    {name: 'Program', fields: [{name: 'Data', type: 'valuetype Bytes', flags: 0x116}], methods: [
      {name: 'Main', result: 'byte[]', locals: ['byte[]'], body(writer, context) {
        writer.op('ldc.i4', 1024).op('newarr', context.resolve('System.Byte')).op('stloc.0');
        writer.op('ldloc.0').op('ldtoken', context.fields.get('Program.Data'));
        writer.op('call', context.member('System.Runtime.CompilerServices.RuntimeHelpers', 'InitializeArray',
          'void', ['System.Array', 'System.RuntimeFieldHandle']));
        writer.op('ldloc.0').op('ret');
      }},
      {name: 'Padding', body(writer) { for (let index = 0; index < 4096; index++) writer.op('nop'); writer.op('ret'); }}
    ]}
  ], {decorate(context) {
    context.md.add(15, [1, 4096, context.types.get('Bytes') & 0xffffff]);
    context.md.add(29, [TEXT_RVA + 72, context.fields.get('Program.Data') & 0xffffff]);
  }});
}

test('actual FieldRVA InitializeArray uses validated immutable PE data and bounded continuation work', () => {
  const vm = new CilVirtualMachine(initializerFixture());
  try {
    const frame = startContinuation(vm, 'InitializeArray');
    const state = frame.intrinsicContinuation;
    const expected = vm.inspector.pe.bytes.slice(state.initializerOffset, state.initializerOffset + state.length);
    const snapshot = vm.snapshot();
    vm.restore(snapshot);
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.deepEqual(vm.heap.get(vm.returnValue).data, expected);
  } finally { vm.stop(); }
});
