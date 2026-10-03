import test from 'node:test';
import assert from 'node:assert/strict';
import {float} from '@sharpforge/bytecode';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {TypedNumericSlots, NumericSlotTag, numericSlots, numericSlotRoot} from '../packages/runtime/src/execution/typed-stack.js';
import {ensureTypedNumericFrame} from '../packages/runtime/src/execution/typed-numeric-frame.js';
import {specializeNumericHandlers} from '../packages/runtime/src/execution/numeric-specialization.js';
import {copyFrames} from '../packages/runtime/src/execution/execution-copy.js';
import {cilHandlers} from '../packages/runtime/src/execution/handlers/index.js';
import {managedFixture} from './managed-fixtures.js';

test('T08.1 raw planes preserve Single/Double and materialize only at ordinary array reads', () => {
  const slots = new TypedNumericSlots([], 2, 8);
  slots.pushFloat(-0, NumericSlotTag.r8);
  slots.pushFloat(NaN, NumericSlotTag.r4);
  slots.pushFloat(1 / 3, NumericSlotTag.r4);
  assert.equal(slots.materializations, 0);
  assert.equal(Array.isArray(slots.array), true);
  assert.equal(slots.array.length, 3);
  assert.equal(slots.array[0].float, 'r8');
  assert(Object.is(slots.array[0].value, -0));
  assert(Number.isNaN(slots.array[1].value));
  assert.equal(slots.array[2].value, Math.fround(1 / 3));
  assert.equal(slots.materializations, 3);
  assert.strictEqual(slots.array[0], slots.array[0]);
  assert.deepEqual(Object.values(slots.array), [...slots.array]);
  slots.array.length = 0;
  slots.array.push(42, null);
  assert.deepEqual([...slots.array], [42, null]);
  assert.equal(slots.tags[0], NumericSlotTag.value);
  assert.equal(slots.tags[1], NumericSlotTag.value);
});

test('T08.1 generic splice, pointer-style assignments and slot deletion retain array behavior', () => {
  const reference = Object.freeze({h: 3, g: 1});
  const slots = new TypedNumericSlots([reference, float(-0), float(Infinity, 'r4')]);
  assert.deepEqual(slots.array.splice(1, 1, float(7, 'r4')), [float(-0)]);
  assert.strictEqual(slots.array[0], reference);
  assert.equal(slots.array[1].float, 'r4');
  slots.array[1] = float(1 / 7);
  assert.equal(slots.numbers[1], 1 / 7);
  delete slots.array[2];
  assert.equal(2 in slots.array, false);
  assert.equal(slots.tags[2], NumericSlotTag.value);
  assert.throws(() => { slots.array.length = -1; }, RangeError);
  assert.equal(slots.array.length, 3);
});

test('T08.1 raw stack operations retain stack budget and underflow faults', () => {
  const slots = new TypedNumericSlots([], 1, 1);
  assert.throws(() => slots.popNumber(), {name: 'InvalidProgramException', message: 'Evaluation stack underflow'});
  slots.pushFloat(-0, NumericSlotTag.r8);
  assert.throws(() => slots.pushFloat(1, NumericSlotTag.r8),
    {name: 'ExecutionLimitException', message: 'Evaluation stack budget exceeded'});
  assert(Object.is(slots.popNumber(), -0));
  assert.equal(slots.materializations, 0);
});

test('T08.1 root scans retain managed values without materializing numeric slots', () => {
  const reference = Object.freeze({h: 1, g: 2});
  const pointer = Object.freeze({byref: true, owner: reference});
  const slots = new TypedNumericSlots([reference, pointer], 4, 8, true);
  slots.pushFloat(-0, NumericSlotTag.r8);
  slots.pushLong(42);
  assert.strictEqual(numericSlotRoot(slots.array, 0), reference);
  assert.strictEqual(numericSlotRoot(slots.array, 1), pointer);
  assert.equal(numericSlotRoot(slots.array, 2), undefined);
  assert.equal(numericSlotRoot(slots.array, 3), undefined);
  assert.equal(slots.materializations, 0);
  assert.strictEqual(numericSlotRoot([reference], 0), reference);
  slots.array.length = 0;
  for (let index = 0; index < 4; index++) assert.equal(numericSlotRoot(slots.array, index), undefined);
});

function planFor(vm, frame = vm.top) {
  const plan = {offsets: frame.offsets, handlers: frame.method.instructions.map(item => cilHandlers.get(item.name))};
  specializeNumericHandlers(vm, frame.method, plan);
  return plan;
}

function executeUntilReturn(vm, plan, afterStep = null) {
  const frame = vm.top;
  ensureTypedNumericFrame(vm, frame, plan);
  while (frame.method.instructions[frame.pc].name !== 'ret') {
    const index = frame.pc++;
    plan.handlers[index](vm, frame, frame.method.instructions[index]);
    afterStep?.(frame.method.instructions[index]);
  }
  return frame;
}

function loopFixture(type) {
  const load = type === 'float' ? 'ldc.r4' : 'ldc.r8';
  return managedFixture({methods: [{name: 'Main', result: type, locals: [type, 'int'], body: writer => writer
    .op(load, -0).op('stloc.0').mark('loop').op('ldloc.0').op('ldloc.1')
    .op(type === 'float' ? 'conv.r4' : 'conv.r8').op(load, 0.1).op('mul').op('add').op('stloc.0')
    .op('ldloc.1').op('ldc.i4.1').op('add').op('stloc.1').op('ldloc.1')
    .op('ldc.i4', 10_000).op('blt', 'loop').op('ldloc.0').op('ret')}]});
}

for (const type of ['float', 'double']) {
  test(`T08.1 ${type} loop keeps all arithmetic/local values in raw planes`, () => {
    const bytes = loopFixture(type);
    const vm = new CilVirtualMachine(bytes, {typedNumericStack: true});
    const frame = executeUntilReturn(vm, planFor(vm));
    for (const values of [frame.stack, frame.locals, frame.args]) {
      assert.equal(numericSlots(values).materializations, 0);
    }
    const generic = new CilVirtualMachine(bytes, {specializeNumericHandlers: false});
    generic.run();
    assert.deepEqual(frame.stack[0], generic.returnValue);
    assert.equal(vm.writeRevision, generic.writeRevision);
  });
}

test('T08.1 ordinary snapshots reify floats, preserve shared locals and rebuild private planes', () => {
  const vm = new CilVirtualMachine(loopFixture('double'), {typedNumericStack: true});
  const frame = executeUntilReturn(vm, planFor(vm));
  const alias = {...frame, id: frame.id + 1};
  const copies = copyFrames([frame, alias]);
  assert.equal(numericSlots(copies[0].locals), undefined);
  assert.strictEqual(copies[0].locals, copies[1].locals);
  const expected = copies[0].locals[0];
  const plan = planFor(vm, copies[0]);
  ensureTypedNumericFrame(vm, copies[0], plan);
  ensureTypedNumericFrame(vm, copies[1], plan);
  assert.strictEqual(copies[0].locals, copies[1].locals);
  assert.deepEqual(copies[0].locals[0], expected);
  copies[0].locals[0] = float(-0);
  assert(Object.is(copies[1].locals[0].value, -0));
  assert.deepEqual(frame.locals[0], expected);
});

test('T08.1 write observers get the original normalized value and previous value', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'float', locals: ['float'], body: writer => writer
    .op('ldc.r8', 1 / 3).op('stloc.0').op('ldloc.0').op('ret')}]});
  const vm = new CilVirtualMachine(bytes, {typedNumericStack: true});
  const writes = [];
  vm.onWrite = write => writes.push(write);
  executeUntilReturn(vm, planFor(vm));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].value, float(1 / 3, 'r4'));
  assert.deepEqual(writes[0].oldValue, float(0, 'r4'));
  assert.equal(vm.writeRevision, 1);
});

for (const input of [-1, -2147483648, -1n, -(1n << 63n), 9007199254740991n]) {
  for (const smallLongFastPath of [false, true]) {
    test(`T08.1 unsigned float conversion preserves ${input} with small-long=${smallLongFastPath}`, () => {
      const wide = typeof input === 'bigint';
      const bytes = managedFixture({methods: [{name: 'Main', result: 'double', body: writer => writer
        .op(wide ? 'ldc.i8' : 'ldc.i4', input).op('conv.r.un').op('ret')}]});
      const vm = new CilVirtualMachine(bytes, {typedNumericStack: true, smallLongFastPath});
      const frame = executeUntilReturn(vm, planFor(vm));
      assert.equal(numericSlots(frame.stack).materializations, 0);
      const expected = wide ? Number(BigInt.asUintN(64, input)) : input >>> 0;
      assert.deepEqual(frame.stack[0], float(expected));
    });
  }
}
