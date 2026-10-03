import test from 'node:test';
import assert from 'node:assert/strict';
import {int64Binary, int64Compare, int64Unary, smallInt64, smallInt64Binary, smallInt64Compare, smallInt64Unary} from '@sharpforge/bytecode';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {TypedNumericSlots, NumericSlotTag, numericSlots} from '../packages/runtime/src/execution/typed-stack.js';
import {specializeNumericHandlers} from '../packages/runtime/src/execution/numeric-specialization.js';
import {ensureTypedNumericFrame} from '../packages/runtime/src/execution/typed-numeric-frame.js';
import {cilHandlers} from '../packages/runtime/src/execution/handlers/index.js';
import {copyFrames} from '../packages/runtime/src/execution/execution-copy.js';
import {managedFixture} from './managed-fixtures.js';

function outcome(operation) {
  try { return {value: BigInt(operation())}; }
  catch (error) { return {name: error.name, message: error.message}; }
}

test('T08.3 Number lanes accept only exact signed-safe integer values', () => {
  for (const value of [0n, 1n, -1n, 9007199254740991n, -9007199254740991n]) {
    assert.equal(typeof smallInt64(value), 'number');
    assert.equal(BigInt(smallInt64(value)), value);
  }
  for (const value of [9007199254740992n, -9007199254740992n, -(1n << 63n), (1n << 63n) - 1n]) {
    assert.equal(smallInt64(value), value);
  }
  for (const value of [NaN, Infinity, 0.5, 9007199254740992]) {
    assert.throws(() => smallInt64(value), {name: 'InvalidProgramException'});
    assert.throws(() => smallInt64Binary('add', value, 1), {name: 'InvalidProgramException'});
  }
  for (const value of [null, undefined, true, '1', {}, 1.5]) {
    assert.throws(() => smallInt64Binary('add', 1, value), {name: 'InvalidProgramException'});
    assert.throws(() => smallInt64Compare(value, 1), {name: 'InvalidProgramException'});
    assert.throws(() => smallInt64Unary('neg', value), {name: 'InvalidProgramException'});
  }
});

test('T08.3 exact range exits, 64-bit wrap, unsigned overflow and division faults use the BigInt path', () => {
  const cases = [
    ['add', 9007199254740991n, 1n], ['sub', -9007199254740991n, 1n],
    ['mul', 94906266n, 94906266n], ['div', 9007199254740991n, 3n],
    ['rem', -9007199254740991n, 3n], ['add', (1n << 63n) - 1n, 1n],
    ['sub', -(1n << 63n), 1n], ['div', -(1n << 63n), -1n],
    ['rem', -(1n << 63n), -1n], ['div', 1n, 0n], ['rem.un', -1n, 0n],
    ['add.ovf', (1n << 63n) - 1n, 1n], ['add.ovf.un', -1n, 1n],
    ['sub.ovf.un', 0n, 1n], ['mul.ovf.un', -1n, 2n], ['div.un', -1n, 2n],
    ['shr.un', -1n, 63n], ['shr', -9007199254740991n, 31n],
    ['shl', 1n, 63n], ['shl', 3n, -1n], ['xor', 9007199254740991n, -1n],
  ];
  for (const [name, left, right] of cases) {
    assert.deepEqual(outcome(() => smallInt64Binary(name, smallInt64(left), smallInt64(right))),
      outcome(() => int64Binary(name, left, right)), name);
  }
});

test('T08.3 signed/unsigned comparisons and unary operations retain 64-bit identity', () => {
  const values = [0n, -1n, 1n, -(1n << 63n), (1n << 63n) - 1n, 9007199254740991n, -9007199254740991n];
  for (const left of values) {
    for (const operation of ['neg', 'not']) {
      assert.equal(BigInt(smallInt64Unary(operation, smallInt64(left))), int64Unary(operation, left));
    }
    for (const right of values) for (const unsigned of [false, true]) {
      assert.equal(smallInt64Compare(smallInt64(left), smallInt64(right), unsigned), int64Compare(left, right, unsigned));
    }
  }
});

test('T08.3 ten million deterministic operations match pure BigInt arithmetic', () => {
  const operations = ['add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'shl', 'shr', 'shr.un', 'div.un', 'rem.un'];
  let state = 0x6b13e8a5;
  for (let index = 0; index < 10_000_000; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    const first = state;
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    const second = state;
    // Alternate ordinary counters, exact 53-bit limits, and full-width fallbacks.
    const left = index % 3 === 0 ? BigInt(first) : index % 3 === 1 ? BigInt(first) * 4194304n + 17n :
      BigInt.asIntN(64, BigInt(first) * 4294967296n + BigInt(second >>> 0));
    const right = BigInt(second || 1);
    const name = operations[index % operations.length];
    const expected = int64Binary(name, left, right);
    const actual = BigInt(smallInt64Binary(name, smallInt64(left), smallInt64(right)));
    if (actual !== expected) assert.fail(`${name}(${left},${right}): ${actual} !== ${expected}, case ${index}`);
  }
});

test('T08.3 generic reads and snapshots always expose BigInt, never a bare small-long Number', () => {
  const slots = new TypedNumericSlots([1n, 1], 2, 8, true);
  assert.equal(slots.tags[0], NumericSlotTag.smallLong);
  assert.equal(slots.tags[1], NumericSlotTag.value);
  assert.strictEqual(slots.array[0], 1n);
  assert.strictEqual(slots.array[1], 1);
  slots.pushLong(9007199254740992n);
  assert.equal(slots.popLong(), 9007199254740992n);
  slots.pushLong(-7);
  assert.equal(slots.array.pop(), -7n);
  const frame = {method: {}, offsets: new Map(), stack: slots.array, locals: slots.array, args: []};
  const [copy] = copyFrames([frame]);
  assert.equal(numericSlots(copy.stack), undefined);
  assert.strictEqual(copy.stack, copy.locals);
  assert.deepEqual(copy.stack, [1n, 1]);
});

test('T08.3 a long counter runs in Number lanes behind its independent flag', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'long', locals: ['long'], body: writer => writer
    .mark('loop').op('ldloc.0').op('ldc.i8', 1n).op('add').op('stloc.0')
    .op('ldloc.0').op('ldc.i8', 10_000n).op('blt', 'loop').op('ldloc.0').op('ret')}]});
  const vm = new CilVirtualMachine(bytes, {smallLongFastPath: true});
  const frame = vm.top;
  const plan = {offsets: frame.offsets, handlers: frame.method.instructions.map(item => cilHandlers.get(item.name))};
  specializeNumericHandlers(vm, frame.method, plan);
  ensureTypedNumericFrame(vm, frame, plan);
  while (frame.method.instructions[frame.pc].name !== 'ret') {
    const index = frame.pc++;
    plan.handlers[index](vm, frame, frame.method.instructions[index]);
  }
  assert.equal(numericSlots(frame.stack).materializations, 0);
  assert.equal(numericSlots(frame.locals).materializations, 0);
  assert.equal(numericSlots(frame.locals).numbers[0], 10_000);
  assert.equal(frame.stack[0], 10_000n);
  const baseline = new CilVirtualMachine(bytes, {specializeNumericHandlers: false});
  baseline.run();
  assert.equal(frame.stack[0], baseline.returnValue);
  assert.equal(vm.writeRevision, baseline.writeRevision);
});

test('T08.3 Int32 widening to UInt64 keeps zero extension', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'ulong', body: writer => writer
    .op('ldc.i4.m1').op('conv.u8').op('ret')}]});
  const vm = new CilVirtualMachine(bytes, {smallLongFastPath: true});
  const frame = vm.top;
  const plan = {offsets: frame.offsets, handlers: frame.method.instructions.map(item => cilHandlers.get(item.name))};
  specializeNumericHandlers(vm, frame.method, plan);
  ensureTypedNumericFrame(vm, frame, plan);
  plan.handlers[0](vm, frame, frame.method.instructions[0]);
  plan.handlers[1](vm, frame, frame.method.instructions[1]);
  assert.equal(frame.stack[0], 4294967295n);
});
