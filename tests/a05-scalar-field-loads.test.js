import test from 'node:test';
import assert from 'node:assert/strict';
import {float} from '@sharpforge/bytecode';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {loadField} from '../packages/runtime/src/execution/field-storage.js';
import {controlFixture} from './support/control-fixture.js';
import {smallStorageFixture, smallStorageTypes} from './support/numeric-storage-fixtures.js';

function fieldFixture(type, value, isStatic) {
  return controlFixture([{name: 'Program', fields: [{name: 'Value', type, flags: isStatic ? 0x16 : 6}], methods: [
    {name: 'Main', result: type, locals: ['Program'], body(writer, context) {
      if (!isStatic) writer.op('newobj', context.methods.get('Program..ctor')).op('stloc.0').op('ldloc.0');
      writer.op(type === 'float' ? 'ldc.r4' : 'ldc.r8', value);
      writer.op(isStatic ? 'stsfld' : 'stfld', context.fields.get('Program.Value'));
      if (!isStatic) writer.op('ldloc.0');
      writer.op('volatile.').op(isStatic ? 'ldsfld' : 'ldfld', context.fields.get('Program.Value')).op('ret');
    }},
    {name: '.ctor', static: false, flags: 0x1886, body: (writer, context) => writer.op('ldarg.0')
      .op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret')},
  ]}]);
}

for (const type of ['float', 'double']) for (const isStatic of [false, true]) {
  for (const value of [-0, NaN, Infinity, 1 / 3]) {
    test(`T08.4 ${isStatic ? 'static' : 'instance'} ${type} field reuses stored ${String(value)}`, () => {
      const vm = new CilVirtualMachine(fieldFixture(type, value, isStatic));
      const target = isStatic ? 'ldsfld' : 'ldfld';
      while (vm.top.method.instructions[vm.top.pc].name !== target) vm.step();
      const stored = isStatic ? [...vm.statics.values()][0] : vm.heap.get(vm.top.stack.at(-1)).data[0];
      assert.equal(vm.top.volatileAccess, true);
      vm.step();
      assert.strictEqual(vm.top.stack.at(-1), stored);
      assert.deepEqual(stored, float(value, type === 'float' ? 'r4' : 'r8'));
      assert.equal(vm.top.volatileAccess, false);
    });
  }
}

for (const {type, suffix} of smallStorageTypes) for (const location of ['field', 'static']) {
  test(`T08.4 ${type} ${location} writes still narrow and notify exactly once`, () => {
    const bytes = smallStorageFixture(type, suffix, location, 0x12345);
    const baseline = new CilVirtualMachine(bytes, {scalarFieldLoads: false});
    const optimized = new CilVirtualMachine(bytes);
    const writes = [];
    optimized.onWrite = write => writes.push(write);
    const expected = baseline.run();
    const actual = optimized.run();
    assert.equal(actual.state, 'terminated', actual.fault?.stack);
    assert.equal(actual.returnValue, expected.returnValue);
    const fieldWrites = writes.filter(write => write.kind === location);
    assert.equal(fieldWrites.length, 1);
    assert.equal(fieldWrites[0].value, actual.returnValue);
  });
}

test('T08.4 non-scalars, undefined values and explicit baseline retain storage adapters', () => {
  const calls = [];
  const vm = {options: {}, storage(value, type) { calls.push({value, type}); return {adapted: value}; }};
  const scalar = {signature: {type: 'System.Single'}};
  const value = float(-0, 'r4');
  assert.strictEqual(loadField(vm, value, scalar), value);
  assert.equal(calls.length, 0);
  for (const type of ['System.Object', 'MyStruct', 'MyEnum', 'int&', 'int pinned']) {
    assert.deepEqual(loadField(vm, value, {signature: {type}}), {adapted: value});
  }
  assert.deepEqual(loadField(vm, undefined, scalar), {adapted: undefined});
  vm.options.scalarFieldLoads = false;
  assert.deepEqual(loadField(vm, value, scalar), {adapted: value});
  assert.equal(calls.length, 7);
});

test('T08.4 changing a resolved field signature invalidates its scalar classification', () => {
  const vm = {options: {}, storage: value => ({copied: value})};
  const field = {signature: {type: 'int'}};
  assert.equal(loadField(vm, 7, field), 7);
  field.signature.type = 'MyStruct';
  assert.deepEqual(loadField(vm, 7, field), {copied: 7});
});
