import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {fieldAssembly} from './a05-runtime-performance-fixture.js';
import {managedFixture} from './managed-fixtures.js';

test('A05 field metadata is reused without retaining one receiver or its mutable data', () => {
  const fixture = fieldAssembly();
  const vm = new CilVirtualMachine(fixture.bytes);
  const first = vm.heap.object('Box`1<int>', [12]);
  const second = vm.heap.object('Box`1<int>', [34]);
  const cached = vm.field(fixture.field, first);
  assert.equal(cached.index, 0);
  assert.equal(cached.field.signature.type, 'System.Int32');

  // A repeated access must not re-read immutable metadata, even for another object.
  vm.inspector.resolveToken = () => { throw new Error('Repeated token resolution'); };
  vm.inspector.signature = () => { throw new Error('Repeated signature decoding'); };
  const next = vm.field(fixture.field, second);
  assert.equal(next.field, cached.field);
  assert.notEqual(next.record, cached.record);
  assert.equal(next.record.data[next.index], 34);
  next.record.data[next.index] = 56;
  assert.equal(vm.field(fixture.field, second).record.data[0], 56);
  assert.throws(() => { next.field.signature.type = 'string'; }, TypeError);
});

test('A05 cached fields preserve closed generic signatures and declaring MemberRef arguments', () => {
  const fixture = fieldAssembly();
  const vm = new CilVirtualMachine(fixture.bytes);
  const integer = vm.heap.object('Box`1<int>', [42]);
  const string = vm.heap.object('Box`1<string>', [null]);
  const integerField = vm.field(fixture.field, integer).field;
  const stringField = vm.field(fixture.field, string).field;
  assert.equal(integerField.signature.type, 'System.Int32');
  assert.equal(stringField.signature.type, 'System.String');
  assert.notEqual(integerField, stringField);
  assert.equal(vm.field(fixture.field, integer).field, integerField);
  assert.equal(vm.field(fixture.members[0], integer).field.signature.type, 'int');
  assert.equal(vm.field(fixture.members[1], string).field.signature.type, 'string');
  assert.equal(vm.field(fixture.members[0]).field.ownerInstance, 'Box`1<int>');
  assert.equal(vm.field(fixture.members[1]).field.ownerInstance, 'Box`1<string>');
});

test('A05 warm field caches still reject null, stale handles, foreign owners and non-field tokens', () => {
  const fixture = fieldAssembly();
  const vm = new CilVirtualMachine(fixture.bytes);
  const instance = vm.heap.object('Box`1<int>', [1]);
  vm.field(fixture.field, instance);
  assert.throws(() => vm.field(fixture.field, null), {name: 'NullReferenceException'});
  const other = vm.heap.object('Other', [2]);
  assert.throws(() => vm.field(fixture.field, other), {name: 'InvalidProgramException'});
  assert.throws(() => vm.field(fixture.method, instance), /Expected a field token/);
  vm.heap.collect();
  assert.throws(() => vm.field(fixture.field, instance), {name: 'InvalidReferenceException'});
  const replacement = vm.heap.object('Box`1<int>', [3]);
  assert.equal(vm.field(fixture.field, replacement).record.data[0], 3);
  assert.throws(() => vm.field(fixture.field, instance), {name: 'InvalidReferenceException'});
});

test('A05 field caches rebuild equivalent closed metadata and use restored heap records after a snapshot', () => {
  const fixture = fieldAssembly();
  const vm = new CilVirtualMachine(fixture.bytes);
  const instance = vm.heap.object('Box`1<int>', [42]);
  const before = vm.field(fixture.field, instance);
  const snapshot = vm.snapshot();
  before.record.data[0] = 99;
  vm.restore(snapshot);
  const restored = vm.field(fixture.field, instance);
  assert.notEqual(restored.field, before.field, 'restore invalidates derived closed field descriptors');
  assert.deepEqual(restored.field, before.field);
  assert.equal(vm.field(fixture.field, instance).field, restored.field, 'the rebuilt descriptor is cached within its new epoch');
  assert.notEqual(restored.record, before.record);
  assert.equal(restored.record.data[restored.index], 42);
});

test('A05 inspector replacement invalidates the field cache even when metadata tokens are reused', () => {
  const fixture = fieldAssembly();
  const vm = new CilVirtualMachine(fixture.bytes);
  const instance = vm.heap.object('Other', [0]);
  const before = vm.field(fixture.otherField, instance);
  const system = vm.typeSystem;
  vm.inspector = new AssemblyInspector(fieldAssembly('string').bytes);
  const after = vm.field(fixture.otherField, instance);
  assert.notEqual(vm.typeSystem, system);
  assert.notEqual(after.field, before.field);
  assert.equal(before.field.signature.type, 'int');
  assert.equal(after.field.signature.type, 'string');
});

test('A05 initialization gates survive snapshots before and after a direct method entry', () => {
  const bytes = managedFixture({
    fields: [{name: 'Value'}],
    methods: [
      {name: 'Main', result: 'void', body: writer => writer.op('ret')},
      {name: 'Target', result: 'int', body: (writer, context) => writer.op('ldsfld', context.fields.Value).op('ret')},
      {name: '.cctor', result: 'void', body: (writer, context) => writer.op('ldc.i4', 42).op('stsfld', context.fields.Value).op('ret')}
    ],
    decorate: ({md}) => { md.rows[2][1][0] &= ~0x100000; }
  });
  const vm = new CilVirtualMachine(bytes);
  vm.frames = [];
  vm.initialized.clear();
  const target = [...vm.inspector.methods.values()].find(method => method.name === 'Target');
  vm.call(target.token, []);
  const pending = vm.snapshot();
  vm.step();
  assert.equal(vm.frames[0].pc, 0, 'Target instruction must wait for its initializer');
  assert.equal(vm.frames[0].needsInitialization, true);
  assert.equal(vm.top.method.name, '.cctor');
  while (vm.top.method.name === '.cctor') vm.step();
  vm.step();
  assert.equal(vm.top.needsInitialization, false);
  const entered = vm.snapshot();
  assert.equal(vm.run().returnValue, 42);
  vm.restore(entered);
  assert.equal(vm.top.needsInitialization, false);
  assert.equal(vm.run().returnValue, 42);
  vm.restore(pending);
  assert.equal(vm.top.needsInitialization, true);
  assert.equal(vm.run().returnValue, 42);
});
