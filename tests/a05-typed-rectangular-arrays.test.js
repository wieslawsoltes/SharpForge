import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, ManagedHeap, VirtualMachine} from '@sharpforge/runtime';
import {compileToIL} from '@sharpforge/compiler';
import {nativeInteger} from '@sharpforge/bytecode';
import {createArray, arrayGet, arraySet, arrayAddress, arrayDimension, arrayVectorRecord,
  validateArrayShape} from '../packages/runtime/src/execution/arrays.js';
import {castReference} from '../packages/runtime/src/execution/casting.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

function fixture() {
  return genericCallFixture([{name: 'Program', methods: [{name: 'Main', locals: ['object'], body: writer => writer.op('ret')}]}]);
}

for (const [type, constructor, value] of [
  ['byte', Uint8Array, 255], ['sbyte', Int8Array, -128], ['short', Int16Array, -32768],
  ['ushort', Uint16Array, 65535], ['char', Uint16Array, 0xffff], ['int', Int32Array, -2147483648],
  ['uint', Uint32Array, -1], ['long', BigInt64Array, -(1n << 63n)], ['ulong', BigUint64Array, -1n],
  ['float', Float32Array, -0], ['double', Float64Array, Infinity]
]) test(`${type} arrays own exact-width backing while preserving evaluation-stack values`, () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const reference = createArray(vm, type, [4]);
    vm.top.locals[0] = reference;
    const record = vm.heap.get(reference);
    assert(record.data instanceof constructor);
    assert.equal(record.size, 32 + 4 * constructor.BYTES_PER_ELEMENT);
    const stored = vm.storage(value, type);
    arraySet(vm, reference, [2], stored);
    assert.deepEqual(arrayGet(vm, reference, [2]), stored);
    vm.heap.collect();
    assert.equal(vm.heap.stats.edgesScanned, 0);
    assert.deepEqual(vm.dereference(arrayAddress(vm, reference, [2])), stored);
    const snapshot = vm.snapshot();
    arraySet(vm, reference, [2], vm.storage(0, type));
    vm.restore(snapshot);
    assert(vm.heap.get(reference).data instanceof constructor);
    assert.deepEqual(arrayGet(vm, reference, [2]), stored);
  } finally { vm.stop(); }
});

test('array length limits derive from exact payload bytes and retain precise negative/over-budget errors', () => {
  const heap = new ManagedHeap({maxBytes: 32 * 1024 * 1024});
  const reference = heap.array('byte', 4_000_000n);
  assert.equal(heap.get(reference).size, 4_000_032);
  assert.throws(() => heap.array('byte', -1n), {name: 'OverflowException'});
  assert.throws(() => heap.array('byte', 33_554_433n), {name: 'OutOfMemoryException'});
  assert.throws(() => new ManagedHeap({maxArrayLength: -1}), {name: 'RangeError'});
  const bounded = new ManagedHeap({maxArrayLength: 3});
  assert.throws(() => bounded.array('byte', 4), {name: 'OutOfMemoryException'});
  assert.equal(bounded.get(bounded.array('long', 3)).data.length, 3);
});

for (const lengths of [[2, 3], [2, 3, 4]]) test(`rank ${lengths.length} arrays use row-major per-dimension bounds`, () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const reference = createArray(vm, 'int', lengths);
    vm.top.locals[0] = reference;
    const last = lengths.map(length => length - 1);
    arraySet(vm, reference, last, 41);
    assert.equal(arrayGet(vm, reference, last), 41);
    assert.equal(vm.heap.get(reference).data.at(-1), 41);
    vm.dereference(arrayAddress(vm, reference, last), true, 42);
    assert.equal(arrayGet(vm, reference, last), 42);
    for (let dimension = 0; dimension < lengths.length; dimension++) {
      assert.equal(arrayDimension(vm, reference, dimension), lengths[dimension]);
      const invalid = [...last];
      invalid[dimension]++;
      assert.throws(() => arrayGet(vm, reference, invalid), {name: 'IndexOutOfRangeException'});
    }
    assert.throws(() => arrayVectorRecord(vm, reference, 0), {name: 'InvalidProgramException'});
    assert.throws(() => arrayGet(vm, reference, [0]), {name: 'InvalidProgramException'});
    validateArrayShape(vm.heap.get(reference));
  } finally { vm.stop(); }
});

test('nonzero lower bounds retain ARRAY identity and checked interior references', () => {
  const vm = new CilVirtualMachine(fixture(), {nativeIntBits: 64});
  try {
    const reference = createArray(vm, 'int', [3], [5], {reflection: true});
    vm.top.locals[0] = reference;
    arraySet(vm, reference, [nativeInteger(7, 64)], 7);
    assert.equal(arrayDimension(vm, reference, 0, 'lower'), 5);
    assert.equal(arrayDimension(vm, reference, 0, 'upper'), 7);
    assert.equal(arrayGet(vm, reference, [7]), 7);
    assert.throws(() => castReference(vm.heap, reference, 'int[]'), {name: 'InvalidCastException'});
    assert.throws(() => arrayGet(vm, reference, [4]), {name: 'IndexOutOfRangeException'});
    assert.throws(() => createArray(vm, 'int', [3], [2147483647]), {name: 'ArgumentOutOfRangeException'});
  } finally { vm.stop(); }
});

test('covariant references allow readonly addresses and reject incompatible writable aliases and stores', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const reference = createArray(vm, 'string', [1]);
    vm.top.locals[0] = reference;
    const text = vm.heap.string('value');
    arraySet(vm, reference, [0], text);
    assert.equal(castReference(vm.heap, reference, 'object[]'), reference);
    assert.throws(() => arraySet(vm, reference, [0], vm.heap.object('object', [])), {name: 'ArrayTypeMismatchException'});
    assert.throws(() => arrayAddress(vm, reference, [0], {type: 'object'}), {name: 'ArrayTypeMismatchException'});
    const address = arrayAddress(vm, reference, [0], {type: 'object', readonly: true});
    assert.equal(vm.dereference(address), text);
    assert.throws(() => vm.dereference(address, true, null), {name: 'InvalidProgramException'});
  } finally { vm.stop(); }
});

test('source and direct CIL preserve typed array arithmetic and Boolean values', () => {
  const result = compileToIL(`using System; class Program { static void Main() {
    float[] f = new float[2]; f[1] = 1.25f; Console.WriteLine(f[1]);
    double[] d = new double[2]; d[1] = -0.25; Console.WriteLine(d[1]);
    bool[] b = new bool[2]; b[1] = true; Console.WriteLine(b[1]);
    ulong[] u = new ulong[2]; u[1] = ulong.MaxValue; Console.WriteLine(u[1]);
  } }`);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  for (const vm of [new VirtualMachine(result.image), new CilVirtualMachine(result.assembly)]) {
    try { assert.equal(vm.run().output, '1.25\n-0.25\nTrue\n18446744073709551615\n'); }
    finally { vm.stop(); }
  }
});
