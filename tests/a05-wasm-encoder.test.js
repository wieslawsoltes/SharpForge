import test from 'node:test';
import assert from 'node:assert/strict';
import {binary, unary, float} from '@sharpforge/bytecode';
import {encodeWasmIR} from '../packages/runtime/src/execution/wasm/encoder.js';
import {createWasmImports} from '../packages/runtime/src/execution/wasm/imports.js';
import {interpretWasmInstruction} from '../packages/runtime/src/execution/wasm/interpret-ir.js';

function machine() {
  const vm = {top: {stack: []}, binary, unary};
  vm.pop = () => vm.top.stack.pop();
  vm.push = value => vm.top.stack.push(value);
  return vm;
}

async function kernel(type, name, rightType = type) {
  const instruction = {pc: 0, name, kind: ['neg', 'not'].includes(name) ? 'unary' : 'binary', type,
    inputs: ['neg', 'not'].includes(name) ? [type] : [type, rightType]};
  const bytes = encodeWasmIR({version: 1, instructions: [instruction]});
  assert.equal(WebAssembly.validate(bytes), true);
  const vm = machine();
  const context = {vm, frame: vm.top, active: true};
  const {instance} = await WebAssembly.instantiate(bytes, createWasmImports(context));
  return {vm, instruction, run: instance.exports.p0};
}

for (const [type, tag] of [['i32', null], ['i64', null], ['f32', 'r4'], ['f64', 'r8']]) {
  test(`T11.2 real Wasm ${type} arithmetic agrees with typed IR interpretation`, async () => {
    const compiled = await kernel(type, 'mul');
    const reference = machine();
    let seed = 0x321;
    for (let index = 0; index < 256; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const left = type === 'i64' ? BigInt(seed) * 65537n : tag ? float(seed / 1024, tag) : seed;
      const right = type === 'i64' ? -17n : tag ? float(-17.1, tag) : -17;
      compiled.vm.top.stack.push(left, right);
      reference.top.stack.push(left, right);
      compiled.run();
      interpretWasmInstruction(reference, reference.top, compiled.instruction);
      assert.deepEqual(compiled.vm.pop(), reference.pop());
    }
  });
}

test('T11.2 native shifts mask mixed-width counts and preserve UInt64 bit patterns', async () => {
  const compiled = await kernel('i64', 'shr.un', 'i32');
  for (const count of [-1, 0, 1, 63, 64, 65]) {
    compiled.vm.top.stack.push(-1n, count);
    compiled.run();
    assert.equal(compiled.vm.pop(), binary('shr.un', -1n, count));
  }
});

test('T11.2 i64 imports preserve every bit above the Number exact range', async () => {
  const values = [9007199254740993n, 9223372036854775807n, -9223372036854775808n, -9007199254740993n];
  for (const name of ['add', 'mul', 'xor']) {
    const compiled = await kernel('i64', name);
    for (const left of values) for (const right of [-1n, 0n, 1n, 9007199254740993n]) {
      compiled.vm.top.stack.push(left, right);
      compiled.run();
      assert.equal(compiled.vm.pop(), binary(name, left, right));
    }
  }
});

test('T11.2 floating negation preserves signed zero, NaN and infinities', async () => {
  for (const type of ['f32', 'f64']) {
    const compiled = await kernel(type, 'neg');
    for (const value of [0, -0, Infinity, -Infinity, NaN]) {
      compiled.vm.push(float(value, type === 'f32' ? 'r4' : 'r8'));
      compiled.run();
      assert.ok(Object.is(compiled.vm.pop().value, -value));
    }
  }
});

test('T11.2 mixed floating operands promote to Double before native arithmetic', async () => {
  const instruction = {pc: 0, name: 'add', kind: 'binary', type: 'f64', inputs: ['f32', 'f64']};
  const vm = machine();
  const context = {vm, frame: vm.top, active: true};
  const {instance} = await WebAssembly.instantiate(encodeWasmIR({version: 1, instructions: [instruction]}), createWasmImports(context));
  vm.top.stack.push(float(0.1, 'r4'), float(0.2, 'r8'));
  instance.exports.p0();
  assert.deepEqual(vm.pop(), float(Math.fround(0.1) + 0.2, 'r8'));
  context.active = false;
  assert.throws(() => instance.exports.p0(), /active frame/);
});
