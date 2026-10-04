import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, lowerWasmIR, encodeWasmIR, instantiateWasmIR} from '@sharpforge/runtime';
import {binary, unary, float} from '../packages/runtime/src/execution/numeric-ops.js';
import {scalarStorageGuard} from '../packages/runtime/src/execution/scalar-storage-plan.js';
import {wasmImportSignatures} from '../packages/runtime/src/execution/wasm/encoding-profile.js';
import {WasmBinary} from '../packages/runtime/src/execution/wasm/binary.js';
import {managedFixture} from './managed-fixtures.js';

const guards = {i32: scalarStorageGuard('int'), i64: scalarStorageGuard('long'),
  f32: scalarStorageGuard('float'), f64: scalarStorageGuard('double')};
function irFor(type = 'i32', name = 'mul', right = type, change = {}) {
  const count = ['neg', 'not'].includes(name) ? 1 : 2;
  const instruction = {...{pc: 0, offset: 0, name, kind: count === 1 ? 'unary' : 'binary', type,
    value: undefined, inputs: count === 1 ? [type] : [type, right], pop: count, push: 1,
    depth: count, next: 1, targets: [], requiresOperandGuards: true}, ...change};
  instruction.inputs = Object.freeze(instruction.inputs);
  instruction.targets = Object.freeze(instruction.targets);
  return Object.freeze({version: 1, token: 0x06000001, maxStack: 8,
    nativeInstructions: instruction.kind === 'host' ? 0 : 1,
    instructions: Object.freeze([Object.freeze(instruction)])});
}

function runtime(ir) {
  const stack = [];
  const counts = {pops: 0, guards: 0, hosts: 0};
  const helpers = {};
  for (const type of Object.keys(guards)) {
    helpers['pop_' + type] = () => {
      counts.pops++;
      const value = stack.pop();
      return type.startsWith('f') ? value.value : value;
    };
    helpers['push_' + type] = value => stack.push(type.startsWith('f') ? float(value, type === 'f32' ? 'r4' : 'r8') : value);
  }
  helpers.guard = (pc, inputs) => {
    counts.guards++;
    const start = stack.length - inputs.length;
    return start >= 0 && inputs.every((type, index) => guards[type](stack[start + index]));
  };
  for (const name of ['allocate', 'field', 'array', 'call', 'host']) helpers[name] = pc => {
    counts.hosts++;
    const instruction = ir.instructions[pc];
    const right = stack.pop();
    stack.push(instruction.kind === 'unary' ? unary(instruction.name, right) : binary(instruction.name, stack.pop(), right));
  };
  return {stack, counts, helpers};
}

async function kernel(type, name, rightType = type) {
  const ir = irFor(type, name, rightType);
  const bytes = encodeWasmIR(ir);
  assert.equal(WebAssembly.validate(bytes), true);
  const state = runtime(ir);
  const compiled = await instantiateWasmIR(ir, state.helpers);
  return {...state, ...compiled, run: compiled.instance.exports.p0};
}

for (const [type, tag] of [['i32', null], ['i64', null], ['f32', 'r4'], ['f64', 'r8']]) {
  test(`real Wasm ${type} arithmetic matches the shared CIL arithmetic over deterministic inputs`, async () => {
    for (const name of ['add', 'sub', 'mul']) {
      const compiled = await kernel(type, name);
      let seed = 0x321;
      for (let index = 0; index < 256; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        const left = type === 'i64' ? BigInt(seed) * 65537n : tag ? float(seed / 1024, tag) : seed;
        const right = type === 'i64' ? -17n : tag ? float(-17.1, tag) : -17;
        compiled.stack.push(left, right);
        compiled.run();
        assert.deepEqual(compiled.stack.pop(), binary(name, left, right));
      }
      assert.equal(compiled.counts.hosts, 0);
      assert.equal(compiled.counts.guards, 256);
    }
  });
}

test('i64 arithmetic, complement and negation retain exact high bits and wrapping', async () => {
  const values = [9007199254740993n, 9223372036854775807n, -9223372036854775808n, -9007199254740993n];
  for (const name of ['add', 'sub', 'mul', 'and', 'or', 'xor']) {
    const compiled = await kernel('i64', name);
    for (const left of values) for (const right of [-1n, 0n, 1n, 9007199254740993n]) {
      compiled.stack.push(left, right);
      compiled.run();
      assert.equal(compiled.stack.pop(), binary(name, left, right));
    }
  }
  for (const type of ['i32', 'i64']) for (const name of ['neg', 'not']) {
    const compiled = await kernel(type, name);
    for (const value of type === 'i64' ? values : [-2147483648, -1, 0, 2147483647]) {
      compiled.stack.push(value);
      compiled.run();
      assert.equal(compiled.stack.pop(), unary(name, value));
    }
  }
});

test('native shifts mask negative and oversized i32 counts without Number conversion of i64 values', async () => {
  for (const type of ['i32', 'i64']) for (const name of ['shl', 'shr', 'shr.un']) {
    const compiled = await kernel(type, name, 'i32');
    const value = type === 'i64' ? -9007199254740993n : -2147483647;
    for (const count of [-1, 0, 1, 31, 32, 63, 64, 65]) {
      compiled.stack.push(value, count);
      compiled.run();
      assert.equal(compiled.stack.pop(), binary(name, value, count));
    }
  }
  const fallback = await kernel('i32', 'shl', 'i64');
  fallback.stack.push(1, 2n);
  assert.throws(() => fallback.run(), TypeError);
  assert.equal(fallback.counts.pops, 0);
  assert.equal(fallback.counts.guards, 0);
  assert.equal(fallback.counts.hosts, 1);
});

test('floating results preserve width, mixed precision, NaN, infinities and signed zero', async () => {
  for (const type of ['f32', 'f64']) {
    const compiled = await kernel(type, 'neg');
    for (const value of [0, -0, Infinity, -Infinity, NaN]) {
      const input = float(value, type === 'f32' ? 'r4' : 'r8');
      compiled.stack.push(input);
      compiled.run();
      assert.deepEqual(compiled.stack.pop(), unary('neg', input));
    }
  }
  const ir = irFor('f64', 'add', 'f64', {inputs: ['f32', 'f64']});
  const state = runtime(ir);
  const compiled = await instantiateWasmIR(ir, state.helpers);
  state.stack.push(float(0.1, 'r4'), float(0.2));
  compiled.instance.exports.p0();
  assert.deepEqual(state.stack.pop(), float(Math.fround(0.1) + 0.2));
  assert(compiled.module instanceof WebAssembly.Module);
});

test('guards fall back before consuming an operand and invalid guard results remain host errors', async () => {
  const ir = irFor();
  const state = runtime(ir);
  const compiled = await instantiateWasmIR(ir, state.helpers);
  state.stack.push(float(1.5), float(2));
  compiled.instance.exports.p0();
  assert.deepEqual(state.stack, [float(3)]);
  assert.equal(state.counts.pops, 0);
  assert.equal(state.counts.hosts, 1);
  const invalid = runtime(ir);
  invalid.helpers.guard = () => 1;
  const rejected = await instantiateWasmIR(ir, invalid.helpers);
  invalid.stack.push(2, 3);
  assert.throws(() => rejected.instance.exports.p0(), /guard must return a boolean/);
  assert.deepEqual(invalid.stack, [2, 3]);
  assert.equal(invalid.counts.pops, 0);
});

test('lowered CIL constants and operation entries produce the ordinary interpreter result', async () => {
  const vm = new CilVirtualMachine(managedFixture());
  try {
    const ir = lowerWasmIR(vm, vm.top.method);
    const state = runtime(ir);
    const compiled = await instantiateWasmIR(ir, state.helpers);
    assert.equal(compiled.byteLength, encodeWasmIR(ir).length);
    assert.equal(WebAssembly.Module.imports(compiled.module).length, wasmImportSignatures.length);
    compiled.instance.exports.p0();
    vm.run();
    assert.equal(state.stack.pop(), vm.returnValue);
  } finally { vm.stop(); }
});

test('encoded constants retain Int64 boundaries and floating special values', async () => {
  for (const [type, name, values] of [
    ['i64', 'ldc.i8', [-(1n << 63n), (1n << 63n) - 1n]],
    ['f32', 'ldc.r4', [0.1, -0, NaN, Infinity]],
    ['f64', 'ldc.r8', [Number.MIN_VALUE, -0, NaN, -Infinity]]
  ]) for (const value of values) {
    const ir = irFor(type, 'mul', type, {kind: 'constant', name, value, inputs: [],
      pop: 0, push: 1, depth: 0, requiresOperandGuards: false});
    const state = runtime(ir);
    const compiled = await instantiateWasmIR(ir, state.helpers);
    assert.equal(WebAssembly.validate(encodeWasmIR(ir)), true);
    compiled.instance.exports.p0();
    assert.deepEqual(state.stack.pop(), type === 'i64' ? value : float(value, type === 'f32' ? 'r4' : 'r8'));
  }
});

test('host entries call their fixed runtime category with operands untouched', async () => {
  for (const [name, category] of [['newarr', 'allocate'], ['ldfld', 'field'], ['ldlen', 'array'], ['call', 'call'], ['nop', 'host']]) {
    const ir = irFor('i32', 'mul', 'i32', {kind: 'host', name, type: null,
      inputs: [], pop: 0, push: 0, depth: 0, requiresOperandGuards: false});
    const state = runtime(ir);
    const calls = [];
    for (const helper of ['allocate', 'field', 'array', 'call', 'host']) state.helpers[helper] = pc => calls.push([helper, pc]);
    const compiled = await instantiateWasmIR(ir, state.helpers);
    state.stack.push('rooted reference placeholder');
    compiled.instance.exports.p0();
    assert.deepEqual(calls, [[category, 0]]);
    assert.deepEqual(state.stack, ['rooted reference placeholder']);
    assert.equal(state.counts.pops, 0);
  }
});

test('immutable IR validation rejects malformed operations, guards, targets and constants', () => {
  const valid = irFor();
  assert.throws(() => encodeWasmIR({...valid}), /immutable/);
  for (const change of [{requiresOperandGuards: false}, {inputs: ['i32', 'unknown']}, {name: 'div'},
    {pc: 1}, {next: 8}, {targets: [0]}, {depth: 1}, {type: 'f32'}, {name: 'toString'}]) {
    assert.throws(() => encodeWasmIR(irFor('i32', 'mul', 'i32', change)), /Invalid Wasm IR/);
  }
  const constant = value => irFor('i32', 'mul', 'i32', {name: 'ldc.i4.1', kind: 'constant', value,
    inputs: [], pop: 0, push: 1, depth: 0, requiresOperandGuards: false});
  assert.throws(() => encodeWasmIR(constant(2)), /macro value/);
  assert.throws(() => encodeWasmIR(constant(1n)), /i32/);
  assert.throws(() => encodeWasmIR(Object.freeze({...valid, version: 2})), /header/);
  assert.throws(() => encodeWasmIR(Object.freeze({...valid, nativeInstructions: 0})), /count mismatch/);
  assert.throws(() => encodeWasmIR(Object.freeze({...valid, instructions: Object.freeze([])})), /instruction limit/);
  const accessor = Object.freeze({...valid, get instructions() { throw new Error('must not execute an IR accessor'); }});
  assert.throws(() => encodeWasmIR(accessor), /accessors are not IR data/);
});

test('byte and instruction bounds reject deliberately and LEB128 has exact boundaries', async () => {
  const ir = irFor();
  const bytes = encodeWasmIR(ir);
  assert.deepEqual(encodeWasmIR(ir, {maxBytes: bytes.length}), bytes);
  assert.throws(() => encodeWasmIR(ir, {maxBytes: bytes.length - 1}), /byte limit/);
  for (const options of [{maxBytes: 7}, {maxBytes: Infinity}, {maxBytes: 16777217},
    {maxMethodInstructions: 0}, {maxMethodInstructions: 65537}, {maxBytes: 1.5}, {eval: true}]) {
    assert.throws(() => encodeWasmIR(ir, options));
  }
  assert.deepEqual([...new WasmBinary(10).signed(-624485).finish()], [0x9b, 0xf1, 0x59]);
  assert.deepEqual([...new WasmBinary(10).unsigned(0xffffffff).finish()], [255, 255, 255, 255, 15]);
  assert.equal(new WasmBinary(10).signed(-(1n << 63n)).finish().length, 10);
  assert.throws(() => new WasmBinary(9).signed(-(1n << 63n)), /byte limit/);
  assert.throws(() => new WasmBinary(10).signed(1n << 64n), /64 bits/);
  assert.throws(() => new WasmBinary(10).byte(256), /Invalid Wasm byte/);
  assert.throws(() => new WasmBinary(10).unsigned(-1), /u32/);
  const state = runtime(ir);
  await assert.rejects(instantiateWasmIR(ir, {...state.helpers, extra: () => {}}), /Unknown Wasm runtime helper/);
  delete state.helpers.guard;
  await assert.rejects(instantiateWasmIR(ir, state.helpers), /Missing Wasm runtime helper/);
});

test('unavailable or blocked Wasm backends report explicit errors without executing helpers', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebAssembly');
  const ir = irFor();
  const state = runtime(ir);
  try {
    Object.defineProperty(globalThis, 'WebAssembly', {...descriptor, value: undefined});
    await assert.rejects(instantiateWasmIR(ir, state.helpers), error => error.code === 'WASM_UNAVAILABLE');
    const denied = new Error('Host policy denied Wasm compilation');
    Object.defineProperty(globalThis, 'WebAssembly', {...descriptor, value: {instantiate: async () => { throw denied; }}});
    await assert.rejects(instantiateWasmIR(ir, state.helpers), error => error.code === 'WASM_COMPILE' && error.cause === denied);
    assert.deepEqual(state.counts, {pops: 0, guards: 0, hosts: 0});
  } finally { Object.defineProperty(globalThis, 'WebAssembly', descriptor); }
});
