import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToAssembly} from '@sharpforge/compiler';
import {AssemblyInspector, resolveExecutionMethod} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {selectedCallOwner} from '../packages/runtime/src/execution/generic-calls.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

const platformButton = 'Microsoft.UI.Xaml.Controls.Button';

function compile(source) {
  const result = compileToAssembly(source, {portablePdb: false});
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.ok(result.assembly?.length);
  const inspector = new AssemblyInspector(result.assembly);
  assert.equal(inspector.metadata.streams.has('#SF'), false);
  return {assembly: result.assembly, inspector};
}

function run(assembly, expected, inspect = null) {
  const vm = new CilVirtualMachine(assembly, {virtualTime: true, maxInstructions: 100_000});
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    if (typeof expected === 'string') assert.equal(result.output, expected);
    else assert.equal(result.returnValue, expected);
    inspect?.(vm);
  } finally {
    vm.stop();
  }
}

for (const name of ['Button', 'Line']) {
  test(`local construction identity: ${name} runs its field initializer and constructor body`, () => {
    const {assembly, inspector} = compile(`using System;
      class ${name} {
        public static int Calls;
        public int Value = 2;
        public ${name}() { Calls++; Value += 5; Console.WriteLine("local constructor"); }
      }
      class Program {
        static void Main() { var value = new ${name}(); Console.WriteLine(value.Value); Console.WriteLine(${name}.Calls); }
      }`);
    const owner = inspector.types.find(type => type.name === name);
    const constructor = owner.methods.find(method => method.name === '.ctor');
    const instruction = inspector.getMethod(inspector.pe.entryPoint).instructions.find(value => value.name === 'newobj');
    assert.equal(resolveExecutionMethod(inspector, instruction.operand).resolvedToken, constructor.token);
    run(assembly, 'local constructor\n7\n1\n', vm => {
      const table = vm.typeSystem.table(owner.token);
      assert.equal(table.name, name);
      const records = vm.heap.records.filter(record => record?.methodTable === table);
      assert.equal(records.length, 1);
      assert.equal(records[0].kind, 'object');
      assert.deepEqual(records[0].data, [7]);
    });
  });
}

test('local construction identity: a user Button and a real framework Button keep separate constructor paths', () => {
  const {assembly, inspector} = compile(`using System;
    class Button { public int Value; public Button() { Value = 9; } }
    class Program {
      static void Main() {
        var local = new Button();
        var platform = new Microsoft.UI.Xaml.Controls.Button();
        platform.Name = "platform";
        Console.WriteLine(local.Value);
        Console.WriteLine(platform.Name);
      }
    }`);
  const constructors = inspector.getMethod(inspector.pe.entryPoint).instructions
    .filter(instruction => instruction.name === 'newobj')
    .map(instruction => resolveExecutionMethod(inspector, instruction.operand));
  assert.equal(constructors.length, 2);
  assert.ok(constructors.find(method => method.owner === 'Button').resolvedToken);
  assert.equal(constructors.find(method => method.owner === platformButton).resolvedToken, null);
  run(assembly, '9\nplatform\n', vm => {
    const local = vm.typeSystem.table('Button');
    const platform = vm.typeSystem.table(platformButton);
    assert.notEqual(local, platform);
    assert.ok(vm.heap.records.some(record => record?.methodTable === local));
    assert.ok(vm.heap.records.some(record => record?.methodTable === platform));
  });
});

function constructorFixture(memberReference) {
  return genericCallFixture([
    {name: 'Button', fields: [{name: 'Value', type: 'int'}], methods: [
      {name: '.ctor', flags: 0x1886, static: false, body(writer, context) {
        writer.op('ldarg.0').op('call', context.member('System.Object', '.ctor', 'void', [], false));
        writer.op('ldarg.0').op('ldc.i4', 42).op('stfld', context.fields.get('Button.Value')).op('ret');
      }},
      {name: 'Read', static: false, result: 'int', body(writer, context) {
        writer.op('ldarg.0').op('ldfld', context.fields.get('Button.Value')).op('ret');
      }}
    ]},
    {name: 'Program', methods: [{name: 'Main', result: 'int', body(writer, context) {
      const constructor = memberReference
        ? context.member(context.types.get('Button'), '.ctor', 'void', [], false)
        : context.methods.get('Button..ctor');
      writer.op('newobj', constructor).op('callvirt', context.methods.get('Button.Read')).op('ret');
    }}]}
  ]);
}

for (const memberReference of [false, true]) {
  const tokenKind = memberReference ? 'MemberRef' : 'MethodDef';
  test(`local construction identity: independent ${tokenKind} metadata executes the resolved user constructor`, () => {
    const assembly = constructorFixture(memberReference);
    const inspector = new AssemblyInspector(assembly);
    const instruction = inspector.getMethod(inspector.pe.entryPoint).instructions[0];
    assert.equal(instruction.name, 'newobj');
    assert.equal(instruction.operand >>> 24, memberReference ? 10 : 6);
    const descriptor = resolveExecutionMethod(inspector, instruction.operand);
    assert.equal(descriptor.owner, 'Button');
    assert.equal(descriptor.resolvedToken, 0x06000001);
    run(assembly, 42);
  });
}

test('local construction identity: field and method receiver checks still reject a framework namesake', () => {
  const vm = new CilVirtualMachine(constructorFixture(false));
  try {
    const user = vm.inspector.types.find(type => type.name === 'Button');
    const field = user.fields[0];
    const read = user.methods.find(method => method.name === 'Read');
    const local = vm.heap.object(vm.typeSystem.table(user.token), [7]);
    const foreign = vm.heap.object(vm.typeSystem.table(platformButton), []);
    assert.equal(vm.field(field.token, local).record.data[0], 7);
    assert.equal(selectedCallOwner(vm, read.token, local, null), null);
    assert.throws(() => vm.field(field.token, foreign), {
      name: 'InvalidProgramException', message: 'Field declaring type does not match the receiver'
    });
    assert.throws(() => selectedCallOwner(vm, read.token, foreign, null), {
      name: 'InvalidProgramException', message: 'Call receiver has no matching declaring instance'
    });
  } finally {
    vm.stop();
  }
});

test('local construction identity: a user delegate named Button keeps its managed constructor contract', () => {
  const {assembly} = compile(`using System;
    delegate int Button();
    class Program {
      static int Read() { return 23; }
      static void Main() { Button value = new Button(Read); Console.WriteLine(value()); }
    }`);
  run(assembly, '23\n');
});
