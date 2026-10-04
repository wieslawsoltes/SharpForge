import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {AssemblyInspector, verifyCilAssembly, normalizeCallType, substituteCallType, resolveExecutionMethod} from '@sharpforge/cil';
import {instantiatedMethod} from '../packages/runtime/src/execution/generics.js';
import {invalidateExecutionCode} from '../packages/runtime/src/execution/code-version.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

const run = bytes => {
  const result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  return result.returnValue;
};
const identity = {name: 'Identity', result: '!!0', parameters: ['!!0'], genericParameters: [{}],
  body: writer => writer.op('ldarg.0').op('ret')};
const identityFixture = () => genericCallFixture([{name: 'Program', methods: [
  {name: 'Main', result: 'int', body: (writer, context) => writer.op('ldc.i4', 42)
    .op('call', context.methodSpec(context.methods.get('Program.Identity'), ['int'])).op('ret')}, identity
]}]);

const cell = {name: 'Cell`1', genericParameters: [{}], fields: [{name: 'Value', type: '!0'}], methods: [
  {name: '.ctor', flags: 0x1886, static: false, parameters: ['!0'], body(writer, context) {
    writer.op('ldarg.0').op('call', context.member('System.Object', '.ctor', 'void', [], false));
    writer.op('ldarg.0').op('ldarg.1').op('stfld', context.fields.get('Cell`1.Value')).op('ret');
  }},
  {name: 'Read', static: false, result: '!0', body: (writer, context) =>
    writer.op('ldarg.0').op('ldfld', context.fields.get('Cell`1.Value')).op('ret')}
]};

test('generic signatures normalize aliases without changing opaque metadata identifiers', () => {
  assert.equal(normalizeCallType('Cell`1<System.Int32[]>'), 'Cell`1<int[]>');
  assert.equal(normalizeCallType('<>Cell(System.Int32)'), '<>Cell(System.Int32)');
  assert.equal(substituteCallType('Cell`1<!!0[]>', ['string'], ['System.Int32']), 'Cell`1<int[]>');
});

test('closed method cache uses canonical handles and shares the original instruction body', () => {
  const vm = new CilVirtualMachine(identityFixture());
  const integer = instantiatedMethod(vm, 0x06000002, null, ['int']);
  assert.equal(integer, instantiatedMethod(vm, 0x06000002, null, ['System.Int32']));
  const text = instantiatedMethod(vm, 0x06000002, null, ['string']);
  assert.notEqual(text, integer);
  assert.equal(text.instructions, integer.instructions);
  assert.equal(integer.instructions, vm.inspector.getMethod(0x06000002).instructions);
  assert.equal(integer.signature.returnType, 'int');
  assert.equal(vm.top.method, vm.inspector.getMethod(vm.report.entryPoint), 'nongeneric frame identity is unchanged');
  invalidateExecutionCode(vm, 'test-edit');
  assert.notEqual(integer, instantiatedMethod(vm, 0x06000002, null, ['int']));
  assert.equal(vm.run().returnValue, 42);
});

test('generic cache limits and malformed contexts are rejected without changing existing methods', () => {
  const vm = new CilVirtualMachine(identityFixture(), {maxGenericInstantiations: 1});
  const integer = instantiatedMethod(vm, 0x06000002, null, ['int']);
  assert.throws(() => instantiatedMethod(vm, 0x06000002, null, ['string']), /cache limit/);
  assert.equal(integer, instantiatedMethod(vm, 0x06000002, null, ['int']));
  const other = new CilVirtualMachine(identityFixture());
  for (const args of [[], ['!!0'], ['int&'], ['void']]) {
    assert.throws(() => instantiatedMethod(other, 0x06000002, null, args));
  }
  assert.throws(() => instantiatedMethod(other, 0x06000002, 'System.String', ['int']), /owner/);
});

test('nested generic class fields and constructors retain their closed owner', () => {
  const bytes = genericCallFixture([cell, {name: 'Program', methods: [{name: 'Main', result: 'int', body(writer, context) {
    const inner = context.typeSpec('Cell`1<int>'), outer = context.typeSpec('Cell`1<Cell`1<int>>');
    writer.op('ldc.i4', 42).op('newobj', context.member(inner, '.ctor', 'void', ['!0'], false));
    writer.op('newobj', context.member(outer, '.ctor', 'void', ['!0'], false));
    writer.op('callvirt', context.member(outer, 'Read', '!0', [], false));
    writer.op('callvirt', context.member(inner, 'Read', '!0', [], false)).op('ret');
  }}]}]);
  assert.equal(run(bytes), 42);
});

test('default(T), initobj, typeof(T), generic arrays and box T use the current frame', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      const method = name => context.methods.get('Program.' + name);
      writer.op('call', context.methodSpec(method('Default'), ['int']));
      writer.op('call', context.methodSpec(method('Default'), ['string'])).op('ldnull').op('ceq').op('add');
      writer.op('call', context.methodSpec(method('Type'), ['string']));
      writer.op('ldtoken', context.resolve('System.String'));
      writer.op('call', context.member('System.Type', 'GetTypeFromHandle', 'System.Type', ['System.RuntimeTypeHandle']));
      writer.op('ceq').op('add');
      writer.op('ldc.i4', 40).op('call', context.methodSpec(method('RoundTrip'), ['int'])).op('add').op('ret');
    }},
    {name: 'Default', result: '!!0', genericParameters: [{}], locals: ['!!0'], body(writer, context) {
      writer.op('ldloca.s', 0).op('initobj', context.typeSpec('!!0')).op('ldloc.0').op('ret');
    }},
    {name: 'Type', result: 'System.Type', genericParameters: [{}], body(writer, context) {
      writer.op('ldtoken', context.typeSpec('!!0'));
      writer.op('call', context.member('System.Type', 'GetTypeFromHandle', 'System.Type', ['System.RuntimeTypeHandle'])).op('ret');
    }},
    {name: 'RoundTrip', result: '!!0', parameters: ['!!0'], genericParameters: [{}], locals: ['!!0[]'], body(writer, context) {
      const type = context.typeSpec('!!0');
      writer.op('ldc.i4.1').op('newarr', type).op('stloc.0');
      writer.op('ldloc.0').op('ldc.i4.0').op('ldarg.0').op('stelem', type);
      writer.op('ldloc.0').op('ldc.i4.0').op('ldelem', type).op('box', type).op('unbox.any', type).op('ret');
    }}
  ]}]);
  assert.equal(run(bytes), 42);
});

test('generic type context and generic method context are substituted independently', () => {
  const bytes = genericCallFixture([
    {name: 'Factory`1', genericParameters: [{}], methods: [{name: 'Make', genericParameters: [{}],
      result: 'Cell`1<!!0>', parameters: ['!!0'], body(writer, context) {
        const owner = context.typeSpec('Cell`1<!!0>');
        writer.op('ldarg.0').op('newobj', context.member(owner, '.ctor', 'void', ['!0'], false)).op('ret');
      }}]}, cell,
    {name: 'Program', methods: [{name: 'Main', result: 'int', body(writer, context) {
      const owner = context.typeSpec('Factory`1<string>');
      const member = context.member(owner, 'Make', 'Cell`1<!!0>', ['!!0'], true, {genericArity: 1});
      writer.op('ldc.i4', 42).op('call', context.methodSpec(member, ['int']));
      writer.op('callvirt', context.member(context.typeSpec('Cell`1<int>'), 'Read', '!0', [], false)).op('ret');
    }}]}
  ]);
  assert.equal(run(bytes), 42);
});

test('snapshot retains a suspended concrete frame while derived instantiation caches are discarded', () => {
  const vm = new CilVirtualMachine(identityFixture());
  while (vm.top.method.name !== 'Identity') vm.step();
  const snapshot = vm.snapshot(), method = vm.top.method;
  assert.equal(vm.run().returnValue, 42);
  vm.restore(snapshot);
  assert.equal(vm.top.method, method);
  assert.equal(vm.top.method.signature.returnType, 'int');
  assert.equal(vm.run().returnValue, 42);
});

test('generic reference constraints reject a value argument before entering its method body', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer.op('ldc.i4.1')
      .op('call', context.methodSpec(context.methods.get('Program.Reference'), ['int'])).op('ret')},
    {...identity, name: 'Reference', genericParameters: [{flags: 4}]}
  ]}]);
  const result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'ArgumentException');
});

test('malformed generic variables and missing MethodSpec are verification diagnostics', () => {
  const bytes = identityFixture(), inspector = new AssemblyInspector(bytes);
  const method = inspector.getMethod(0x06000002);
  assert.equal(resolveExecutionMethod(inspector, inspector.getMethod(inspector.pe.entryPoint).instructions[1].operand)
    .signature.returnType, 'int');
  method.locals = ['!!1'];
  assert(verifyCilAssembly(inspector).issues.some(issue => /outside its declaring context/.test(issue.message)));
  const missing = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer.op('ldc.i4.1')
      .op('call', context.methods.get('Program.Identity')).op('ret')}, identity
  ]}]);
  assert(verifyCilAssembly(missing).issues.some(issue => /MethodSpec arguments/.test(issue.message)));
});
