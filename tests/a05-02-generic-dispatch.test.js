import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {codedIndex, verifyCilAssembly} from '@sharpforge/cil';
import {genericCallFixture} from './support/generic-call-fixture.js';

const run = bytes => {
  const result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  return result.returnValue;
};
const constructor = (base = 'System.Object') => ({name: '.ctor', static: false, flags: 0x1886,
  body(writer, context) {
    const owner = base.includes('<') ? context.typeSpec(base) : context.resolve(base);
    writer.op('ldarg.0').op('call', context.member(owner, '.ctor', 'void', [], false)).op('ret');
  }});

test('generic virtual overrides execute with the selected declaring type and method arguments', () => {
  const bytes = genericCallFixture([
    {name: 'Base`1', genericParameters: [{}], methods: [constructor(), {
      name: 'Read', static: false, flags: 0x1c6, genericParameters: [{}], result: '!!0', parameters: ['!!0'],
      body: writer => writer.op('ldarg.1').op('ret')
    }]},
    {name: 'Derived`1', base: 'Base`1<!0[]>', genericParameters: [{}], methods: [constructor('Base`1<!0[]>'), {
      name: 'Read', static: false, flags: 0xc6, genericParameters: [{}], result: '!!0', parameters: ['!!0'],
      locals: ['!0'], body: writer => writer.op('ldloc.0').op('pop').op('ldarg.1').op('ret')
    }]},
    {name: 'Program', methods: [{name: 'Main', result: 'int', body(writer, context) {
      const derived = context.typeSpec('Derived`1<string>'), base = context.typeSpec('Base`1<string[]>');
      const declaration = context.member(base, 'Read', '!!0', ['!!0'], false, {genericArity: 1});
      writer.op('newobj', context.member(derived, '.ctor', 'void', [], false)).op('ldc.i4', 42);
      writer.op('callvirt', context.methodSpec(declaration, ['int'])).op('ret');
    }}]}
  ]);
  assert.equal(run(bytes), 42);
});

test('explicit implementations of two closed interfaces with the same MethodDef stay distinct', () => {
  const bytes = genericCallFixture([
    {name: 'IValue`1', interface: true, flags: 0xa1, genericParameters: [{}], methods: [
      {name: 'Read', static: false, flags: 0x5c6, result: '!0'}
    ]},
    {name: 'Values', interfaces: ['IValue`1<int>', 'IValue`1<string>'], methods: [constructor(),
      {name: 'ReadInt', static: false, flags: 0x1e1, result: 'int', body: writer => writer.op('ldc.i4', 41).op('ret')},
      {name: 'ReadString', static: false, flags: 0x1e1, result: 'string', body: writer => writer.op('ldnull').op('ret')}
    ]},
    {name: 'Program', methods: [{name: 'Main', result: 'int', locals: ['Values'], body(writer, context) {
      writer.op('newobj', context.methods.get('Values..ctor')).op('stloc.0');
      writer.op('ldloc.0').op('callvirt', context.member(context.typeSpec('IValue`1<int>'), 'Read', '!0', [], false));
      writer.op('ldloc.0').op('callvirt', context.member(context.typeSpec('IValue`1<string>'), 'Read', '!0', [], false));
      writer.op('ldnull').op('ceq').op('add').op('ret');
    }}]}
  ], {decorate(context) {
    for (const [type, body] of [['int', 'ReadInt'], ['string', 'ReadString']]) {
      const declaration = context.member(context.typeSpec('IValue`1<' + type + '>'), 'Read', '!0', [], false);
      context.md.add(25, [context.types.get('Values') & 0xffffff,
        codedIndex('MethodDefOrRef', context.methods.get('Values.' + body)), codedIndex('MethodDefOrRef', declaration)]);
    }
  }});
  assert.equal(run(bytes), 42);
  const vm = new CilVirtualMachine(bytes);
  const method = [...vm.inspector.methods.values()].find(method => method.owner === 'IValue`1').token;
  assert.throws(() => vm.typeSystem.dispatch.resolve('Values', method), /ambiguous/);
});

test('closed static fields and initialization are independent even inside a generic caller', () => {
  const bytes = genericCallFixture([
    {name: 'Counter`1', flags: 1, genericParameters: [{}], fields: [{name: 'Value', flags: 0x16, type: 'int'}], methods: [
      {name: '.cctor', flags: 0x1891, body: (writer, context) => writer.op('ldc.i4.1')
        .op('stsfld', context.fields.get('Counter`1.Value')).op('ret')},
      {name: 'Next', result: 'int', body(writer, context) {
        const field = context.fields.get('Counter`1.Value');
        writer.op('ldsfld', field).op('dup').op('ldc.i4.1').op('add').op('stsfld', field).op('ret');
      }}
    ]},
    {name: 'Program', methods: [
      {name: 'Main', result: 'int', body: (writer, context) => writer.op('call',
        context.methodSpec(context.methods.get('Program.Sum'), ['string'])).op('ret')},
      {name: 'Sum', genericParameters: [{}], result: 'int', body(writer, context) {
        const first = context.member(context.typeSpec('Counter`1<int>'), 'Next', 'int');
        const second = context.member(context.typeSpec('Counter`1<!!0>'), 'Next', 'int');
        writer.op('call', first).op('call', first).op('add').op('call', second).op('add').op('ret');
      }}
    ]}
  ]);
  assert.equal(run(bytes), 4);
});

test('inherited generic fields use the declaring base context, including nested array substitutions', () => {
  const bytes = genericCallFixture([
    {name: 'Base`1', genericParameters: [{}], fields: [{name: 'Value', type: '!0'}], methods: [constructor(),
      {name: 'Read', static: false, result: '!0', body: (writer, context) => writer.op('ldarg.0')
        .op('ldfld', context.fields.get('Base`1.Value')).op('ret')}
    ]},
    {name: 'Derived`1', base: 'Base`1<!0[]>', genericParameters: [{}], methods: [constructor('Base`1<!0[]>')]},
    {name: 'Program', methods: [{name: 'Main', result: 'int', locals: ['Derived`1<int>'], body(writer, context) {
      const derived = context.typeSpec('Derived`1<int>'), base = context.typeSpec('Base`1<int[]>');
      writer.op('newobj', context.member(derived, '.ctor', 'void', [], false)).op('stloc.0');
      writer.op('ldloc.0').op('ldc.i4.3').op('newarr', context.resolve('System.Int32'));
      writer.op('stfld', context.field(base, 'Value', '!0'));
      writer.op('ldloc.0').op('callvirt', context.member(base, 'Read', '!0', [], false));
      writer.op('ldlen').op('conv.i4').op('ret');
    }}]}
  ]);
  assert.equal(run(bytes), 3);
});

test('aggregate generic values and external generic methods keep explicit unsupported diagnostics', () => {
  const bytes = genericCallFixture([
    {name: 'Value', base: 'System.ValueType', fields: [{name: 'N', type: 'int'}], methods: []},
    {name: 'Program', methods: [
      {name: 'Main', body: (writer, context) => writer.op('call',
        context.methodSpec(context.methods.get('Program.Use'), ['Value'])).op('ret')},
      {name: 'Use', genericParameters: [{}], body: writer => writer.op('ret')}
    ]}
  ]);
  assert(verifyCilAssembly(bytes).issues.some(issue => /T03 value storage/.test(issue.message)));
  const external = genericCallFixture([{name: 'Program', methods: [{name: 'Main', body(writer, context) {
    writer.op('newobj', context.member(context.typeSpec('Unsupported.Collection`1<int>'), '.ctor', 'void', [], false));
    writer.op('pop').op('ret');
  }}]}]);
  assert(verifyCilAssembly(external).issues.some(issue => issue.code === 'IL_REFERENCE'));
});

// Decimal is an admitted scalar carrier even though its CLR metadata is a value type.
test('closed generic Decimal default and initobj retain the scalar storage contract', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'System.Decimal', body: (writer, context) => writer
      .op('call', context.methodSpec(context.methods.get('Program.Default'), ['System.Decimal'])).op('ret')},
    {name: 'Default', result: '!!0', locals: ['!!0'], genericParameters: [{}], body: (writer, context) => writer
      .op('ldloca.s', 0).op('initobj', context.typeSpec('!!0')).op('ldloc.0').op('ret')}
  ]}]);
  const value = run(bytes);
  assert.equal(value.coefficient, 0n);
  assert.equal(value.scale, 0);
  assert(Object.isFrozen(value));
});
