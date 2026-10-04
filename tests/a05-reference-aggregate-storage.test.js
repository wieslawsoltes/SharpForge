import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {boxValue, unboxValue} from '../packages/runtime/src/execution/boxing.js';
import {createValueFromFields} from '../packages/runtime/src/execution/value-types.js';
import {sizeOfType} from '../packages/runtime/src/execution/value-layout.js';
import {storageDefault} from '../packages/runtime/src/execution/storage.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

const record = {name: 'Record', base: 'System.ValueType', flags: 0x100109, methods: [],
  fields: [{name: 'Text', type: 'string'}, {name: 'Number', type: 'int'}]};
const outer = {name: 'Outer', base: 'System.ValueType', flags: 0x100109, methods: [],
  fields: [{name: 'Value', type: 'valuetype Record'}]};
const union = {name: 'ReferenceUnion', base: 'System.ValueType', flags: 0x100111, methods: [],
  fields: [{name: 'First', type: 'object', offset: 0}, {name: 'Second', type: 'object', offset: 0},
    {name: 'Count', type: 'int', offset: 8}]};

function fixture(types = [record, outer], locals = ['valuetype Record', 'valuetype Record', 'valuetype Outer', 'object']) {
  return genericCallFixture([...types, {name: 'Program', methods: [{name: 'Main', locals, body: writer => writer.op('ret')}]}], {
    decorate(context) {
      for (const type of types) for (const field of type.fields) if (field.offset !== undefined) {
        context.md.add(16, [field.offset, context.fields.get(type.name + '.' + field.name) & 0xffffff]);
      }
    }
  });
}

function field(vm, local, index) {
  return vm.address('field', index, vm.address('local', local));
}

test('nested aggregate copies retain managed identity and root their fields during collection', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const text = vm.heap.string('retained by value');
    vm.dereference(field(vm, 0, 0), true, text);
    vm.dereference(field(vm, 0, 1), true, 7);
    vm.dereference(vm.address('local', 1), true, vm.top.locals[0]);
    const copied = vm.top.locals[1];
    assert.notEqual(copied, vm.top.locals[0]);
    assert.equal(copied.fields[0], text);
    vm.dereference(field(vm, 0, 0), true, null);
    vm.dereference(field(vm, 2, 0), true, copied);
    vm.dereference(vm.address('local', 1), true, vm.top.locals[0]);
    vm.heap.collect();
    assert.equal(vm.heap.get(text).data, 'retained by value');
    assert.equal(vm.top.locals[2].fields[0].fields[1], 7);
    const boxed = boxValue(vm, vm.top.locals[2], 'Outer');
    vm.top.locals[3] = boxed;
    vm.top.locals[2] = storageDefault(vm, 'Outer');
    vm.heap.collect();
    assert.equal(unboxValue(vm, boxed, 'Outer').fields[0].fields[0], text);
    vm.top.locals[3] = null;
    vm.heap.collect();
    assert.throws(() => vm.heap.get(text), {name: 'InvalidReferenceException'});
  } finally { vm.stop(); }
});

test('aggregate references reject foreign handles, incompatible types and pointer escape atomically', () => {
  const vm = new CilVirtualMachine(fixture()), other = new CilVirtualMachine(fixture());
  try {
    const original = vm.top.locals[0], target = field(vm, 0, 0);
    for (const value of [other.heap.string('foreign'), vm.heap.object('System.Object', []),
      vm.address('local', 1), Object.freeze({h: 0, g: 1}), 'host string']) {
      assert.throws(() => vm.dereference(target, true, value), {name: 'InvalidProgramException'});
      assert.equal(vm.top.locals[0], original);
    }
  } finally { vm.stop(); other.stop(); }
});

test('explicit managed-reference aliases share GC slots without encoding handles into scalar bytes', () => {
  for (const nativeIntBits of [32, 64]) {
    const vm = new CilVirtualMachine(fixture([union], ['valuetype ReferenceUnion', 'valuetype ReferenceUnion']), {nativeIntBits});
    try {
      const text = vm.heap.string('one slot');
      vm.dereference(field(vm, 0, 0), true, text);
      assert.equal(vm.dereference(field(vm, 0, 1)), text);
      assert(vm.top.locals[0].explicitBytes.slice(0, nativeIntBits / 8).every(value => value === 0));
      vm.dereference(vm.address('local', 1), true, vm.top.locals[0]);
      vm.dereference(field(vm, 0, 1), true, null);
      assert.equal(vm.dereference(field(vm, 0, 0)), null);
      assert.equal(vm.dereference(field(vm, 1, 1)), text);
      vm.heap.collect();
      assert.equal(vm.heap.get(text).data, 'one slot');
      assert.equal(sizeOfType(vm, 'ReferenceUnion'), nativeIntBits === 64 ? 16 : 12);
    } finally { vm.stop(); }
  }
});

for (const fields of [
  [{name: 'Reference', type: 'object', offset: 0}, {name: 'Scalar', type: 'int', offset: 0}],
  [{name: 'Reference', type: 'object', offset: 1}]
]) test('explicit misaligned or scalar-overlapped managed slots fail type loading', () => {
  assert.throws(() => new CilVirtualMachine(fixture([{...union, fields}], ['valuetype ReferenceUnion'])),
    {name: 'TypeLoadException'});
});

test('explicit runtime value descriptors share the ordinary immutable aggregate admission', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    vm.heap.methodTables.define({name: 'Runtime.Builder', base: 'System.ValueType',
      flags: {valueType: true, runtimeValue: true}, fields: [{name: 'Task', type: 'object'}]});
    const reference = vm.heap.object('System.Object', []);
    const value = createValueFromFields(vm, vm.typeSystem.table('Runtime.Builder'), [reference]);
    assert.equal(value.fields[0], reference);
    assert(Object.isFrozen(value.fields));
  } finally { vm.stop(); }
});
