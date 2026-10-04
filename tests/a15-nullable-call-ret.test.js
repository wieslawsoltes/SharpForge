import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly, formatILDocument, assembleILDocument} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

const nullable = type => 'valuetype System.Nullable`1<valuetype ' + type + '>';
const roundTrip = bytes => assembleILDocument(formatILDocument(bytes)).bytes;

function temporalFixture(type) {
  const valueType = nullable(type);
  const member = (context, name, result, parameters = []) =>
    context.member(context.typeSpec(valueType), name, result, parameters, false);
  return genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', maxStack: 2, locals: [valueType], body(writer, context) {
      const printBoolean = context.member('System.Console', 'WriteLine', 'void', ['bool']);
      const printInteger = context.member('System.Console', 'WriteLine', 'void', ['int']);
      const length = context.member('System.String', 'get_Length', 'int', [], false);
      const echo = context.methods.get('Program.Echo');
      writer.op('ldloc.0').op('call', echo).op('stloc.0');
      writer.op('ldloca.s', 0).op('call', member(context, 'get_HasValue', 'bool')).op('call', printBoolean);
      writer.op('ldloca.s', 0).op('call', member(context, 'ToString', 'string')).op('callvirt', length).op('call', printInteger);
      if (type === 'System.TimeSpan') {
        writer.op('ldc.r8', 1500).op('call', context.member(type, 'FromMilliseconds', type, ['double']));
      } else writer.op('newobj', context.member(type, '.ctor', 'void', [], false));
      writer.op('newobj', member(context, '.ctor', 'void', ['!0'])).op('call', echo).op('stloc.0');
      writer.op('ldloca.s', 0).op('call', member(context, 'get_HasValue', 'bool')).op('call', printBoolean);
      writer.op('ldloca.s', 0).op('call', member(context, 'get_Value', '!0'));
      const fieldType = type === 'System.TimeSpan' ? 'double' : 'int';
      writer.op('call', context.member(type, type === 'System.TimeSpan' ? 'get_TotalSeconds' : 'get_Year', fieldType, [], false));
      writer.op('call', context.member('System.Console', 'WriteLine', 'void', [fieldType]));
      writer.op('ldloca.s', 0).op('call', member(context, 'ToString', 'string')).op('callvirt', length);
      writer.op('ldc.i4.0').op('cgt').op('call', printBoolean).op('ret');
    }},
    {name: 'Echo', maxStack: 1, parameters: [valueType], result: valueType, body(writer, context) {
      writer.op('call', context.member('System.GC', 'Collect', 'void')).op('ldarg.0').op('ret');
    }}
  ]}]);
}

for (const type of ['System.TimeSpan', 'System.DateTimeOffset']) {
  for (const [engine, prepare] of [['cil', bytes => bytes], ['reassembled', roundTrip]]) {
    test(`A15 ${engine}: real ${type}? parameters and returns preserve presence, scalar data and ToString`, () => {
      const vm = new CilVirtualMachine(prepare(temporalFixture(type)), {initialThreshold: 64});
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.message);
        assert.equal(result.output, 'False\n0\nTrue\n' + (type === 'System.TimeSpan' ? '1.5' : '1') + '\nTrue\n');
        assert.equal(vm.heap.pins.length, 0);
      } finally { vm.stop(); }
    });
  }
}

test('A15 temporal Nullable logical stack bytes include both scalar records before allocation or restore', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', maxStack: 0, locals: [nullable('System.TimeSpan'), nullable('System.DateTimeOffset')],
      body: writer => writer.op('ret')}
  ]}]);
  // Header 16 + TimeSpan record 24 + DateTimeOffset record 32; no evaluation-stack slots.
  for (const nativeIntBits of [32, 64]) {
    assert.throws(() => new CilVirtualMachine(bytes, {nativeIntBits, maxStackBytes: 71}), {name: 'StackOverflowException'});
    const vm = new CilVirtualMachine(bytes, {nativeIntBits, maxStackBytes: 72});
    try {
      const snapshot = vm.snapshot(), frames = vm.frames, revision = vm.heap.mutationRevision;
      vm.options.maxStackBytes = 71;
      assert.throws(() => vm.restore(snapshot), /Snapshot exceeds managed stack byte budget/);
      assert.equal(vm.frames, frames);
      assert.equal(vm.heap.mutationRevision, revision);
      vm.options.maxStackBytes = 72;
      vm.restore(snapshot);
      assert.equal(vm.run().state, 'terminated');
    } finally { vm.stop(); }
  }
});

const source = `using System;
TimeSpan? duration = Echo.Duration(TimeSpan.FromMilliseconds(1500.0));
DateTimeOffset? instant = Echo.Date(new DateTimeOffset());
GC.Collect();
Console.WriteLine(duration.Value.TotalSeconds); Console.WriteLine(instant.Value.Year);
Console.WriteLine(Echo.Duration(null).ToString() == ""); Console.WriteLine(Echo.Date(null).ToString() == "");
Console.WriteLine(duration.ToString() == Convert.ToString((object)duration.Value));
Console.WriteLine(instant.ToString() == Convert.ToString((object)instant.Value));
class Echo {
  public static TimeSpan? Duration(TimeSpan? value) { GC.Collect(); return value; }
  public static DateTimeOffset? Date(DateTimeOffset? value) { GC.Collect(); return value; }
}`;
let built;
function program() {
  if (!built) {
    built = compileToIL(source);
    assert.equal(built.success, true, built.diagnostics.map(value => value.message).join('\n'));
  }
  return built;
}

for (const [engine, create] of Object.entries({
  source: build => new VirtualMachine(build.image),
  canonical: build => new VirtualMachine(loadAssembly(build.assembly)),
  cil: build => new CilVirtualMachine(build.assembly),
  reassembled: build => new CilVirtualMachine(roundTrip(build.assembly))
})) {
  test(`A15 ${engine}: temporal nullable source methods preserve the underlying formatter and empty text`, () => {
    const vm = create(program());
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '1.5\n1\nTrue\nTrue\nTrue\nTrue\n');
      assert.equal(vm.heap.pins.length, 0);
    } finally { vm.stop(); }
  });
}
