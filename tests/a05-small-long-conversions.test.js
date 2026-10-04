import test from 'node:test';
import assert from 'node:assert/strict';
import {convert, float, nativeInteger} from '@sharpforge/bytecode';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {smallLongConversion} from '../packages/runtime/src/execution/int64-fast.js';
import {floatSlots, SmallLongSlotTag} from '../packages/runtime/src/execution/typed-stack.js';
import {getDecodePlan} from '../packages/runtime/src/execution/decode-plan.js';
import {managedFixture} from './managed-fixtures.js';

const names = ['conv.i8', 'conv.u8', 'conv.ovf.i8', 'conv.ovf.i8.un', 'conv.ovf.u8', 'conv.ovf.u8.un'];
const bounds = [-2147483648, -2147483647, -1, 0, 1, 2147483646, 2147483647];

function assembly(name, input = 1) {
  return managedFixture({methods: [{name: 'Main', result: 'long', maxStack: 1,
    body: writer => writer.integer(input).op(name).op('ret')} ]});
}

test('private widening policies match the existing conversion contract at every Int32 boundary', () => {
  for (const name of names) {
    const widen = smallLongConversion(name);
    for (const value of bounds) {
      const actual = widen(value);
      if (name === 'conv.ovf.u8' && value < 0) {
        assert.equal(actual, undefined);
        assert.throws(() => convert(name, value), {name: 'OverflowException', message: 'Checked conversion overflow'});
      } else {
        assert(Number.isSafeInteger(actual));
        assert.equal(BigInt(actual), convert(name, value));
      }
    }
  }
  assert.equal(smallLongConversion('conv.i8')(-1), -1);
  assert.equal(smallLongConversion('conv.u8')(-1), 4294967295);
  for (const name of ['conv.i4', 'conv.r8', 'conv.i', 'conv.ovf.u', 'conv.i8.un']) {
    assert.equal(smallLongConversion(name), null);
  }
});

test('direct CIL widening enters an Int64 lane without a BigInt boundary read', () => {
  for (const name of names) for (const input of bounds) {
    const bytes = assembly(name, input);
    const expected = new CilVirtualMachine(bytes).run();
    const vm = new CilVirtualMachine(bytes, {smallLongs: true});
    assert(getDecodePlan(vm, vm.top.method).numericHandlerIds.includes(name.replaceAll('.', '_') + '_small_i8'));
    if (name === 'conv.ovf.u8' && input < 0) {
      const actual = vm.run();
      assert.equal(actual.state, 'faulted');
      assert.equal(actual.fault.name, expected.fault.name);
      assert.equal(actual.fault.message, expected.fault.message);
    } else {
      vm.step();
      vm.step();
      const slots = floatSlots(vm.top.stack);
      assert.equal(slots.tags[0], SmallLongSlotTag);
      assert.equal(slots.materializations, 0);
      assert.equal(BigInt(slots.numbers[0]), expected.returnValue);
      assert.equal(vm.run().returnValue, expected.returnValue);
    }
  }
});

test('compact Int32 constants feed a small-long loop through the existing shared handlers', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'long', maxStack: 2, locals: ['long'], body(writer) {
    writer.integer(0).op('conv.i8').op('stloc.0').mark('loop');
    writer.op('ldloc.0').integer(1).op('conv.i8').op('add').op('stloc.0');
    writer.op('ldloc.0').integer(100).op('conv.i8').op('blt.s', 'loop').op('ldloc.0').op('ret');
  }}]});
  for (const smallLongs of [false, true]) {
    const vm = new CilVirtualMachine(bytes, {smallLongs});
    let remaining = 1200;
    while (vm.top.method.instructions[vm.top.pc].name !== 'ret') {
      assert(--remaining > 0);
      vm.step();
    }
    if (smallLongs) {
      assert.equal(floatSlots(vm.top.stack).materializations, 0);
      assert.equal(floatSlots(vm.top.locals).materializations, 0);
    }
    assert.equal(vm.run().returnValue, 100n);
  }
});

test('host-edited tags and noncanonical Numbers use their actual conversion categories', () => {
  for (const name of names) {
    for (const input of [float(-1.75), float(NaN), nativeInteger(-1, 32), 7n, -1n, 4294967295, 4294967296, null]) {
      const outcomes = [];
      for (const smallLongs of [false, true]) {
        const vm = new CilVirtualMachine(assembly(name), {smallLongs});
        vm.step();
        vm.top.stack[0] = input;
        const actual = vm.run();
        outcomes.push({state: actual.state, value: actual.returnValue, name: actual.fault?.name, message: actual.fault?.message});
      }
      assert.deepEqual(outcomes[1], outcomes[0], `${name}: ${String(input)}`);
    }
  }
});

test('option edits, array replacement and snapshot replay preserve widening boundaries', () => {
  for (const edit of ['off', 'array', 'descriptor', 'snapshot']) {
    const vm = new CilVirtualMachine(assembly('conv.u8', -1), {smallLongs: true});
    vm.step();
    if (edit === 'off') vm.options.smallLongs = false;
    else if (edit === 'array') vm.top.stack = [-1];
    else if (edit === 'descriptor') Object.defineProperty(vm.top.stack, '0', {value: -1});
    else {
      const saved = vm.snapshot();
      assert.equal(saved.frames[0].stack[0], -1);
      vm.restore(saved);
      vm.state = 'running';
    }
    assert.equal(vm.run().returnValue, 4294967295n);
  }
});
