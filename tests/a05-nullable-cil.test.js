import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

const nullable = type => 'valuetype System.Nullable`1<' +
  (['Point', 'System.Decimal'].includes(type) ? 'valuetype ' : '') + type + '>';
const point = {name: 'Point', base: 'System.ValueType', flags: 0x100109,
  fields: [{name: 'X', type: 'int'}], methods: []};
const member = (context, type, name, result, parameters = []) =>
  context.member(context.typeSpec(nullable(type)), name, result, parameters, false);
function fixture(body, {locals = [nullable('int')], result = 'void', types = [], maxStack = 16} = {}) {
  return genericCallFixture([...types, {name: 'Program', methods: [{name: 'Main', locals, result, maxStack, body}]}]);
}

test('guest CIL Nullable defaults, both constructor forms, properties, boxing and unbox.any agree', () => {
  const bytes = fixture((writer, context) => {
    const type = context.typeSpec(nullable('int'));
    const print = context.member('System.Console', 'WriteLine', 'void', ['int']);
    const boolean = context.member('System.Console', 'WriteLine', 'void', ['bool']);
    const has = member(context, 'int', 'get_HasValue', 'bool');
    const value = member(context, 'int', 'get_Value', '!0');
    const construct = member(context, 'int', '.ctor', 'void', ['!0']);
    const fallback = member(context, 'int', 'GetValueOrDefault', '!0');
    writer.op('ldloca.s', 0).op('call', has).op('call', boolean);
    writer.op('ldloca.s', 0).op('call', fallback).op('call', print);
    writer.op('ldloca.s', 0).op('ldc.i4.s', 99)
      .op('call', member(context, 'int', 'GetValueOrDefault', '!0', ['!0'])).op('call', print);
    writer.op('ldloc.0').op('box', type).op('ldnull').op('ceq').op('call', boolean);
    writer.op('ldloca.s', 0).op('ldc.i4.s', 12).op('call', construct);
    writer.op('ldloca.s', 0).op('call', has).op('call', boolean);
    writer.op('ldloca.s', 0).op('call', value).op('call', print);
    writer.op('ldloc.0').op('box', type).op('unbox.any', type).op('stloc.1');
    writer.op('ldloca.s', 0).op('initobj', type);
    writer.op('ldloca.s', 1).op('call', value).op('call', print);
    writer.op('ldc.i4.s', 23).op('newobj', construct).op('stloc.0');
    writer.op('ldloca.s', 0).op('call', member(context, 'int', 'ToString', 'string'));
    writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['string']));
    writer.op('ldloc.0').op('box', type);
    writer.op('callvirt', context.member('System.Object', 'GetType', 'System.Type', [], false));
    writer.op('callvirt', context.member('System.Type', 'get_Name', 'string', [], false));
    writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['string']));
    writer.op('ldnull').op('unbox.any', type).op('stloc.1');
    writer.op('ldloca.s', 1).op('call', has).op('call', boolean).op('ret');
  }, {locals: [nullable('int'), nullable('int')]});
  for (const nativeIntBits of [32, 64]) {
    const vm = new CilVirtualMachine(bytes, {nativeIntBits});
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, 'False\n0\n99\nTrue\nTrue\n12\n12\n23\nInt32\nFalse\n');
    } finally { vm.stop(); }
  }
});

test('guest Nullable user structs copy underlying fields; Decimal constructors retain exact values', () => {
  const bytes = fixture((writer, context) => {
    const type = context.typeSpec(nullable('Point')), x = context.fields.get('Point.X');
    const get = member(context, 'Point', 'get_Value', '!0');
    const print = context.member('System.Console', 'WriteLine', 'void', ['int']);
    writer.op('ldloca.s', 0).op('ldc.i4.7').op('stfld', x);
    writer.op('ldloc.0').op('newobj', member(context, 'Point', '.ctor', 'void', ['!0'])).op('stloc.1');
    writer.op('ldloca.s', 0).op('ldc.i4.s', 18).op('stfld', x);
    writer.op('ldloc.1').op('box', type).op('unbox.any', type).op('stloc.1');
    writer.op('ldloca.s', 1).op('call', get).op('ldfld', x).op('call', print);
    writer.op('ldloca.s', 1).op('initobj', type).op('ldloca.s', 1);
    writer.op('call', member(context, 'Point', 'GetValueOrDefault', '!0')).op('ldfld', x).op('call', print);
    writer.op('ldc.i4.s', 42).op('newobj', context.member('System.Decimal', '.ctor', 'void', ['int'], false));
    writer.op('newobj', member(context, 'System.Decimal', '.ctor', 'void', ['!0'])).op('stloc.2');
    writer.op('ldloca.s', 2).op('call', member(context, 'System.Decimal', 'get_Value', '!0'));
    writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['System.Decimal'])).op('ret');
  }, {types: [point], locals: ['valuetype Point', nullable('Point'), nullable('System.Decimal')]});
  const vm = new CilVirtualMachine(bytes);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '7\n0\n42\n');
  } finally { vm.stop(); }
});

for (const [name, body, expected] of [
  ['empty Value', (writer, context) => writer.op('ldloca.s', 0)
    .op('call', member(context, 'int', 'get_Value', '!0')), 'InvalidOperationException'],
  ['wrong box', (writer, context) => writer.op('ldc.i8', 5n).op('box', context.resolve('System.Int64'))
    .op('unbox.any', context.typeSpec(nullable('int'))), 'InvalidCastException']
]) test(`guest Nullable ${name} rejects with its managed exception`, () => {
  const vm = new CilVirtualMachine(fixture((writer, context) => { body(writer, context); writer.op('pop').op('ret'); }));
  try { assert.equal(vm.run().fault.name, expected); }
  finally { vm.stop(); }
});

test('Nullable array defaults and present values remain distinct across collection', () => {
  const bytes = fixture((writer, context) => {
    const type = context.typeSpec(nullable('int'));
    writer.op('ldc.i4.2').op('newarr', type).op('stloc.0');
    writer.op('ldloc.0').op('ldc.i4.0').op('ldc.i4.s', 37)
      .op('newobj', member(context, 'int', '.ctor', 'void', ['!0'])).op('stelem', type);
    writer.op('call', context.member('System.GC', 'Collect', 'void'));
    writer.op('ldloc.0').op('ldc.i4.1').op('ldelem', type).op('box', type).op('ldnull').op('ceq');
    writer.op('ldloc.0').op('ldc.i4.0').op('ldelem', type).op('box', type)
      .op('unbox.any', context.resolve('System.Int32')).op('add').op('ret');
  }, {locals: [nullable('int') + '[]'], result: 'int'});
  const vm = new CilVirtualMachine(bytes);
  try { assert.equal(vm.run().returnValue, 38); }
  finally { vm.stop(); }
});

test('guest-produced Nullable values copy and replay without sharing mutable payloads or foreign types', () => {
  const bytes = fixture((writer, context) => writer.op('ldc.i4.s', 17)
    .op('newobj', member(context, 'int', '.ctor', 'void', ['!0'])).op('stloc.0')
    .op('ldloca.s', 0).op('initobj', context.typeSpec(nullable('int')))
    .op('ldloca.s', 0).op('call', member(context, 'int', 'get_HasValue', 'bool')).op('ret'), {result: 'bool'});
  const vm = new CilVirtualMachine(bytes), foreign = new CilVirtualMachine(bytes);
  try {
    for (let count = 0; !vm.top.locals[0].hasValue && count < 20; count++) vm.runSlice({instructionBudget: 1});
    assert.equal(vm.top.locals[0].value, 17);
    const snapshot = vm.snapshot(), original = vm.top.locals[0];
    assert(Object.isFrozen(original));
    assert.throws(() => foreign.dereference(foreign.address('local', 0), true, original), /Nullable value type/);
    assert.throws(() => vm.storage(Object.freeze({...original, hasValue: 1}), original.nullableType), /Nullable value type/);
    assert.throws(() => vm.storage(original, 'object'), /Nullable storage requires/);
    const hybrid = Object.freeze({...vm.heap.string('hidden reference'), float: 'r8', value: 17});
    assert.throws(() => vm.storage(Object.freeze({...original, value: hybrid}), original.nullableType), /Nullable payload/);
    assert.equal(vm.run().returnValue, false);
    assert.equal(snapshot.frames[0].locals[0].value, 17);
    vm.restore(snapshot);
    assert.equal(vm.top.locals[0].nullableType, original.nullableType);
    assert.equal(vm.run().returnValue, false);
  } finally { vm.stop(); foreign.stop(); }
});

for (const type of ['object', 'System.Nullable`1<int>', 'Windows.Foundation.Point']) {
  test(`Nullable rejects unsupported ${type} payloads before guest execution`, () => {
    const bytes = fixture(writer => writer.op('ret'), {locals: [nullable(type)]});
    assert.throws(() => new CilVirtualMachine(bytes), {name: 'NotSupportedException'});
  });
}

test('Nullable unbox interior remains an explicit verifier boundary', () => {
  const bytes = fixture((writer, context) => writer.op('ldnull').op('unbox', context.typeSpec(nullable('int')))
    .op('pop').op('ret'));
  assert.throws(() => new CilVirtualMachine(bytes), error => error.name === 'CilError' &&
    error.issues.some(issue => issue.code === 'IL_TYPE' && issue.message === 'unbox requires supported value storage'));
});

test('Nullable member admission validates the closed return type', () => {
  const bytes = fixture((writer, context) => writer.op('ldloca.s', 0)
    .op('call', member(context, 'int', 'get_Value', 'long')).op('pop').op('ret'));
  assert.throws(() => new CilVirtualMachine(bytes), /not implemented/);
});

test('Nullable byte quotas include aligned HasValue and payload widths before allocation and restore', () => {
  const bytes = fixture(writer => writer.op('ret'), {
    locals: [nullable('nint'), nullable('long'), nullable('System.Decimal')], maxStack: 0
  });
  for (const [nativeIntBits, limit] of [[32, 64], [64, 72]]) {
    assert.throws(() => new CilVirtualMachine(bytes, {nativeIntBits, maxStackBytes: limit - 1}), {name: 'StackOverflowException'});
    const vm = new CilVirtualMachine(bytes, {nativeIntBits, maxStackBytes: limit});
    try {
      const snapshot = vm.snapshot(), frames = vm.frames, revision = vm.heap.mutationRevision;
      vm.options.maxStackBytes--;
      assert.throws(() => vm.restore(snapshot), /Snapshot exceeds managed stack byte budget/);
      assert.equal(vm.frames, frames);
      assert.equal(vm.heap.mutationRevision, revision);
      vm.options.maxStackBytes++;
      vm.restore(snapshot);
      assert.equal(vm.run().state, 'terminated');
    } finally { vm.stop(); }
  }
});
