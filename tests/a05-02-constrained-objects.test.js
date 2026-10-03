import test from 'node:test';
import assert from 'node:assert/strict';
import {Writer, codedIndex} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';
import {objectEquals, objectHashCode, objectToString} from '../packages/runtime/src/execution/object-intrinsics.js';
import {boxValue, createValue} from '../packages/runtime/src/execution/value-types.js';

function fixture() {
  return controlFixture([
    {name: 'Value', base: 'System.ValueType', flags: 0x100109,
      fields: [{name: 'Number', type: 'int', flags: 6}], methods: [
        {name: 'GetHashCode', result: 'int', static: false, flags: 0xc6,
          body: writer => writer.op('ldc.i4', 123).op('ret')}
      ]},
    {name: 'Plain', base: 'System.ValueType', flags: 0x100109,
      fields: [{name: 'Number', type: 'int', flags: 6}], methods: []},
    {name: 'Program', methods: [{name: 'Main', result: 'int',
      localBytes: context => new Writer().u8(7).u8(1).u8(0x11)
        .compressed(codedIndex('TypeDefOrRef', context.resolve('Value'))).finish(),
      body(writer, context) {
        writer.op('ldloca.s', 0).op('constrained.', context.resolve('Value'));
        writer.op('callvirt', context.member('System.Object', 'GetHashCode', 'int', [], false)).op('ret');
      }}]}
  ]);
}

test('T02.4 a constrained user override executes without allocating a box', () => {
  const vm = new CilVirtualMachine(fixture());
  const before = vm.heap.stats.allocations;
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.returnValue, 123);
  assert.equal(vm.heap.stats.allocations, before);
});

test('T02.4 inherited value equality and hashes preserve exact boxed types', () => {
  const vm = new CilVirtualMachine(fixture());
  const a = boxValue(vm, createValue(vm, 'Plain', [42]), 'Plain');
  const b = boxValue(vm, createValue(vm, 'Plain', [42]), 'Plain');
  const different = boxValue(vm, createValue(vm, 'Plain', [43]), 'Plain');
  assert.equal(objectEquals(vm, a, b), true);
  assert.equal(objectEquals(vm, a, different), false);
  assert.equal(objectHashCode(vm, a), objectHashCode(vm, b));
  assert.equal(vm.value(objectToString(vm, a)), 'Plain');
  const integer = boxValue(vm, 42, 'int');
  assert.equal(objectHashCode(vm, integer), 42);
  assert.equal(vm.value(objectToString(vm, integer)), '42');
  assert.equal(objectEquals(vm, integer, boxValue(vm, 42n, 'long')), false);
  assert.throws(() => objectHashCode(vm, null), {name: 'NullReferenceException'});
});
