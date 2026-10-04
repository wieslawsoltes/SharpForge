import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {int32BitsToSingle, int64BitsToDouble, singleToInt32Bits, doubleToInt64Bits} from '@sharpforge/bytecode';
import {genericCallFixture} from './support/generic-call-fixture.js';
import {memoryCall} from '../packages/runtime/src/execution/memory-calls.js';
import {arrayCall} from '../packages/runtime/src/execution/array-calls.js';
import {createArray} from '../packages/runtime/src/execution/arrays.js';
import {stackAllocate} from '../packages/runtime/src/execution/stack-memory.js';
import {spanGet, spanSet, spanLength} from '../packages/runtime/src/execution/spans.js';

const descriptor = (owner, name, parameters, returnType, isStatic = true) => ({kind: 'method', owner, name,
  signature: {parameters, returnType, isStatic, genericArity: 0, callingConvention: 0}});
const fixture = () => genericCallFixture([{name: 'Program', methods: [{name: 'Main',
  locals: ['System.Span`1<int>'], body: writer => writer.op('ret')}]}]);

test('BitConverter byte arrays share floating bit adapters and precise range exceptions', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    for (const [type, name, patterns, decode, encode] of [
      ['float', 'Single', [0, -2147483648, 1, 0x7f800000, 0x7fc01234], int32BitsToSingle, singleToInt32Bits],
      ['double', 'Double', [0n, -(1n << 63n), 1n, 0x7ff0000000000000n, 0x7ff8000000001234n], int64BitsToDouble, doubleToInt64Bits]
    ]) {
      for (const bits of patterns) {
        const bytes = memoryCall(vm, descriptor('System.BitConverter', 'GetBytes', [type], 'byte[]'), [decode(bits)]).value;
        const value = memoryCall(vm, descriptor('System.BitConverter', 'To' + name, ['byte[]', 'int'], type), [bytes, 0]).value;
        assert.equal(encode(value), bits);
      }
    }
    const bytes = createArray(vm, 'byte', [4]);
    const read = descriptor('System.BitConverter', 'ToInt32', ['byte[]', 'int'], 'int');
    assert.throws(() => memoryCall(vm, read, [null, 0]), {name: 'ArgumentNullException'});
    assert.throws(() => memoryCall(vm, read, [bytes, -1]), {name: 'ArgumentOutOfRangeException'});
    assert.throws(() => memoryCall(vm, read, [bytes, 4]), {name: 'ArgumentOutOfRangeException'});
    assert.throws(() => memoryCall(vm, read, [bytes, 1]), {name: 'ArgumentException'});
    assert.equal(memoryCall(vm, descriptor('System.BitConverter', 'GetBytes', ['object'], 'byte[]'), [null]).handled, false);
  } finally { vm.stop(); }
});

test('Span constructors update exact local storage and readonly conversion preserves slice ownership', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const owner = 'System.Span`1<int>', readonly = 'System.ReadOnlySpan`1<int>';
    const pointer = stackAllocate(vm, 16);
    const address = vm.address('local', 0);
    memoryCall(vm, descriptor(owner, '.ctor', ['void*', 'int'], 'void', false), [address, pointer, 4]);
    const span = vm.top.locals[0];
    spanSet(vm, span, 1, 29);
    const slice = memoryCall(vm, descriptor(owner, 'Slice', ['int', 'int'], owner, false), [address, 1, 2]).value;
    assert.equal(spanGet(vm, slice, 0), 29);
    const view = memoryCall(vm, descriptor(owner, 'op_Implicit', [owner], readonly), [slice]).value;
    assert.equal(spanLength(vm, view), 2);
    assert.throws(() => spanSet(vm, view, 0, 3), {name: 'InvalidProgramException'});
    assert.throws(() => vm.storage(view, owner), {name: 'InvalidProgramException'});
  } finally { vm.stop(); }
});

test('rectangular pseudo-methods share exact element storage and owned address operations', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const owner = 'int[,]';
    const reference = arrayCall(vm, descriptor(owner, '.ctor', ['int', 'int'], 'void', false), [2, 3], 'newobj').value;
    arrayCall(vm, descriptor(owner, 'Set', ['int', 'int', 'int'], 'void', false), [reference, 1, 2, 37]);
    assert.equal(arrayCall(vm, descriptor(owner, 'Get', ['int', 'int'], 'int', false), [reference, 1, 2]).value, 37);
    const pointer = arrayCall(vm, descriptor(owner, 'Address', ['int', 'int'], 'int&', false), [reference, 1, 2]).value;
    vm.dereference(pointer, true, 41);
    assert.equal(vm.heap.get(reference).data[5], 41);
    assert.throws(() => arrayCall(vm, descriptor(owner, 'Get', ['int', 'int'], 'int', false), [reference, 2, 0]),
      {name: 'IndexOutOfRangeException'});
    assert.equal(arrayCall(vm, descriptor(owner, 'Get', ['int'], 'int', false), [reference, 1]).handled, false);
  } finally { vm.stop(); }
});

test('the exact System.String implicit readonly Span contract retains immutable string interiors', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const input = vm.heap.string('ABC');
    const operation = descriptor('System.String', 'op_Implicit', ['string'], 'System.ReadOnlySpan`1<char>');
    const result = memoryCall(vm, operation, [input]);
    assert.equal(result.handled, true);
    assert.equal(result.value.pointer.owner, input);
    assert.equal(spanGet(vm, result.value, 1), 66);
    assert.throws(() => spanSet(vm, result.value, 0, 88), {name: 'InvalidProgramException'});
    const invalid = descriptor('System.String', 'op_Implicit', ['string'], 'System.Span`1<char>');
    assert.equal(memoryCall(vm, invalid, [input]).handled, false);
  } finally { vm.stop(); }
});
