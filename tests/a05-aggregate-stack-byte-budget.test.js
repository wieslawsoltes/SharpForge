import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, framePoolStatistics} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

const structure = (name, fields) => ({name, base: 'System.ValueType', flags: 0x100109,
  fields: fields.map((type, index) => ({name: 'Field' + index, type})), methods: []});
const types = [
  structure('Pair', ['valuetype System.Decimal', 'valuetype System.Decimal']),
  structure('Nested', ['valuetype Pair', 'double']),
  structure('Small', ['byte', 'byte', 'byte'])
];
const fixture = (type, methods = []) => genericCallFixture([...types, {name: 'Program', methods: [
  {name: 'Main', locals: ['valuetype ' + type], maxStack: 0, body: writer => writer.op('ret')}, ...methods
]}]);

for (const nativeIntBits of [32, 64]) {
  for (const [type, limit] of [['Pair', 48], ['Nested', 56], ['Small', 24]]) {
    test(`${type} locals use aligned layout bytes under ABI${nativeIntBits}`, () => {
      const bytes = fixture(type);
      assert.throws(() => new CilVirtualMachine(bytes, {nativeIntBits, maxStackBytes: limit - 1}),
        {name: 'StackOverflowException'});
      const vm = new CilVirtualMachine(bytes, {nativeIntBits, maxStackBytes: limit});
      try { assert.equal(vm.run().state, 'terminated'); }
      finally { vm.stop(); }
    });
  }
}

test('nested struct argument admission includes both caller and callee before allocating a frame', () => {
  const bytes = genericCallFixture([...types, {name: 'Program', methods: [
    {name: 'Main', locals: ['valuetype Nested'], maxStack: 1, body: (writer, context) => writer
      .op('ldloc.0').op('call', context.methods.get('Program.Consume')).op('ret')},
    {name: 'Consume', parameters: ['valuetype Nested'], maxStack: 0, body: writer => writer.op('ret')}
  ]}]);
  for (const limit of [119, 120]) {
    const vm = new CilVirtualMachine(bytes, {maxStackBytes: limit});
    try {
      const result = vm.run();
      if (limit === 119) {
        assert.equal(result.fault?.name, 'StackOverflowException');
        assert.equal(framePoolStatistics(vm).framesAllocated, 1);
      } else assert.equal(result.state, 'terminated', result.fault?.message);
    } finally { vm.stop(); }
  }
});

test('nested layout snapshot rejection is atomic and the exact quota replays', () => {
  const vm = new CilVirtualMachine(fixture('Nested'), {maxStackBytes: 56});
  try {
    const snapshot = vm.snapshot(), frames = vm.frames, revision = vm.heap.mutationRevision;
    vm.options.maxStackBytes = 55;
    assert.throws(() => vm.restore(snapshot), /Snapshot exceeds managed stack byte budget/);
    assert.equal(vm.frames, frames);
    assert.equal(vm.heap.mutationRevision, revision);
    vm.options.maxStackBytes = 56;
    vm.restore(snapshot);
    assert.equal(vm.run().state, 'terminated');
  } finally { vm.stop(); }
});
