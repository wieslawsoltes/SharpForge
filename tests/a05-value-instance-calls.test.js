import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

const pointType = 'valuetype Point';
function pointMethods() {
  return [
    {name: '.ctor', parameters: ['int'], static: false, flags: 0x1886, body(writer, context) {
      writer.op('ldarg.0').op('ldarg.1').op('stfld', context.fields.get('Point.X')).op('ret');
    }},
    {name: 'Add', parameters: ['int'], static: false, body(writer, context) {
      writer.op('call', context.member('System.GC', 'Collect', 'void'));
      writer.op('ldarg.0').op('dup').op('ldfld', context.fields.get('Point.X'));
      writer.op('ldarg.1').op('add').op('stfld', context.fields.get('Point.X')).op('ret');
    }},
    {name: 'Get', result: 'int', static: false, body(writer, context) {
      writer.op('ldarg.0').op('ldfld', context.fields.get('Point.X')).op('ret');
    }},
    {name: 'Forward', parameters: ['int'], static: false, body(writer, context) {
      writer.op('ldarg.0').op('ldarg.1').op('call', context.methods.get('Point.Add')).op('ret');
    }}
  ];
}

function fixture(body, {locals = [pointType], result = 'int', initLocals = true, methods = pointMethods()} = {}) {
  return genericCallFixture([
    {name: 'Point', base: 'System.ValueType', flags: 0x100109,
      fields: [{name: 'X', type: 'int'}, {name: 'Y', type: 'int'}], methods},
    {name: 'Other', base: 'System.ValueType', flags: 0x100109,
      fields: [{name: 'X', type: 'int'}, {name: 'Y', type: 'int'}], methods: []},
    {name: 'Envelope', base: 'System.ValueType', flags: 0x100109,
      fields: [{name: 'Value', type: pointType}], methods: []},
    {name: 'Program', methods: [{name: 'Main', result, locals, initLocals, body}]}
  ]);
}

function run(bytes, assertResult, options) {
  const vm = new CilVirtualMachine(bytes, options);
  try { assertResult(vm.run(), vm); }
  finally { vm.stop(); }
}

test('direct struct calls mutate local, array, field and box interiors while ordinary copies stay independent', () => {
  const bytes = fixture((writer, context) => {
    const type = context.resolve('Point'), ctor = context.methods.get('Point..ctor');
    const add = context.methods.get('Point.Forward'), get = context.methods.get('Point.Get');
    const print = context.member('System.Console', 'WriteLine', 'void', ['int']);
    writer.op('ldc.i4.3').op('newobj', ctor).op('stloc.0').op('ldloc.0').op('stloc.1');
    writer.op('ldloca.s', 0).op('ldc.i4.4').op('call', add);
    writer.op('ldloca.s', 1).op('call', get).op('call', print);
    writer.op('ldloca.s', 0).op('call', get).op('call', print);
    writer.op('ldloca.s', 0).op('ldc.i4.s', 99).op('stfld', context.fields.get('Point.Y'));
    writer.op('ldloca.s', 0).op('ldc.i4.s', 11).op('call', ctor);
    writer.op('ldloc.0').op('ldfld', context.fields.get('Point.Y')).op('call', print);
    writer.op('ldc.i4.1').op('newarr', type).op('stloc.2');
    writer.op('ldloc.2').op('ldc.i4.0').op('ldelema', type).op('ldc.i4.s', 42).op('call', ctor);
    writer.op('ldloc.2').op('ldc.i4.0').op('ldelema', type).op('ldc.i4.1').op('call', add);
    writer.op('ldloc.2').op('ldc.i4.0').op('ldelema', type).op('call', get).op('call', print);
    writer.op('ldloc.0').op('box', type).op('stloc.3');
    writer.op('ldloc.3').op('unbox', type).op('ldc.i4.2').op('call', add);
    writer.op('ldloc.3').op('unbox', type).op('call', get).op('call', print);
    writer.op('ldloca.s', 0).op('call', get).op('call', print);
    writer.op('ldloca.s', 4).op('ldflda', context.fields.get('Envelope.Value'));
    writer.op('ldc.i4.s', 55).op('call', ctor);
    writer.op('ldloca.s', 4).op('ldflda', context.fields.get('Envelope.Value')).op('call', get).op('call', print);
    writer.op('ret');
  }, {locals: [pointType, pointType, pointType + '[]', 'object', 'valuetype Envelope'], result: 'void'});
  for (const nativeIntBits of [32, 64]) for (const typedNumericStack of [false, true]) run(bytes, (result, vm) => {
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '3\n7\n99\n43\n13\n11\n55\n');
    assert(vm.heap.stats.collections > 0);
    assert.equal(vm.heap.records.some(record => record?.kind === 'object' && record.type === 'Point'), false);
  }, {nativeIntBits, typedNumericStack});
});

test('direct .ctor initializes an uninitialized local without weakening ordinary receiver reads', () => {
  run(fixture((writer, context) => {
    writer.op('ldloca.s', 0).op('ldc.i4.s', 17).op('call', context.methods.get('Point..ctor'));
    writer.op('ldloca.s', 0).op('call', context.methods.get('Point.Get'));
    writer.op('ldloc.0').op('ldfld', context.fields.get('Point.Y')).op('add').op('ret');
  }, {initLocals: false}), result => {
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, 17);
  });
  run(fixture((writer, context) => writer.op('ldloca.s', 0).op('call', context.methods.get('Point.Get')).op('ret'),
    {initLocals: false}), result => assert.equal(result.fault?.name, 'InvalidProgramException'));
});

for (const [name, receiver, fault] of [
  ['null', writer => writer.op('ldnull'), 'NullReferenceException'],
  ['inline copy', writer => writer.op('ldloc.0'), 'InvalidProgramException'],
  ['wrong struct address', writer => writer.op('ldloca.s', 1), 'InvalidProgramException'],
  ['boxed reference', (writer, context) => writer.op('ldloc.0').op('box', context.resolve('Point')), 'InvalidProgramException']
]) test(`direct struct call rejects a ${name} receiver`, () => {
  run(fixture((writer, context) => {
    receiver(writer, context);
    writer.op('call', context.methods.get('Point.Get')).op('ret');
  }, {locals: [pointType, 'valuetype Other']}), result => assert.equal(result.fault?.name, fault));
});

test('virtual and byref-return user-struct calls remain explicitly unsupported', () => {
  run(fixture((writer, context) => writer.op('ldloca.s', 0).op('callvirt', context.methods.get('Point.Get')).op('ret')),
    result => assert.equal(result.fault?.name, 'NotSupportedException'));
  const methods = [{name: 'Address', result: 'int&', static: false, body(writer, context) {
    writer.op('ldarg.0').op('ldflda', context.fields.get('Point.X')).op('ret');
  }}];
  run(fixture((writer, context) => writer.op('ldloca.s', 0).op('call', context.methods.get('Point.Address'))
    .op('ldind.i4').op('ret'), {methods}), result => assert.equal(result.fault?.name, 'NotSupportedException'));
});

test('host entry rejects foreign, readonly and expired this addresses before adding a frame', () => {
  const bytes = fixture((writer, context) => writer.op('ldloca.s', 0).op('call', context.methods.get('Point.Get')).op('ret'));
  const first = new CilVirtualMachine(bytes), second = new CilVirtualMachine(bytes);
  try {
    const method = first.inspector.types.find(type => type.name === 'Point').methods.find(method => method.name === 'Get');
    const address = first.address('local', 0), foreign = second.address('local', 0);
    assert.throws(() => first.call(method.token, [foreign]), /another VM/);
    assert.throws(() => first.call(method.token, [Object.freeze({...address, readonly: true})]), {name: 'NotSupportedException'});
    assert.equal(first.frames.length, 1);
    assert.equal(first.run().returnValue, 0);
    assert.throws(() => first.call(method.token, [address]), /outlived/);
    assert.equal(first.frames.length, 0);
  } finally { first.stop(); second.stop(); }
});

test('newobj constructor storage survives snapshot replay and is released after return or stop', () => {
  const bytes = fixture((writer, context) => writer.op('ldc.i4.s', 23).op('newobj', context.methods.get('Point..ctor'))
    .op('stloc.0').op('ldloca.s', 0).op('call', context.methods.get('Point.Get')).op('ret'));
  const vm = new CilVirtualMachine(bytes);
  try {
    vm.runSlice({instructionBudget: 2, timeBudgetMs: Infinity});
    assert.equal(vm.top.method.name, '.ctor');
    const reference = vm.top.returnObject, snapshot = vm.snapshot();
    vm.heap.collect();
    assert.equal(vm.heap.get(reference).kind, 'box');
    assert.equal(vm.run().returnValue, 23);
    vm.heap.collect();
    assert.throws(() => vm.heap.get(reference), {name: 'InvalidReferenceException'});
    vm.restore(snapshot);
    assert.equal(vm.run().returnValue, 23);
    vm.restore(snapshot);
    vm.stop();
    vm.heap.collect();
    assert.throws(() => vm.heap.get(reference), {name: 'InvalidReferenceException'});
  } finally { vm.stop(); }
});

test('a throwing constructor never returns its temporary box and stop releases its inspectable root', () => {
  const methods = [{name: '.ctor', static: false, flags: 0x1886, body(writer) {
    writer.op('ldnull').op('throw');
  }}];
  run(fixture((writer, context) => writer.op('newobj', context.methods.get('Point..ctor')).op('pop').op('ret'),
    {methods, result: 'void'}), (result, vm) => {
    assert.equal(result.fault?.name, 'NullReferenceException');
    assert.equal(result.fault.phase, 'unhandled');
    assert.deepEqual(vm.frames.map(frame => frame.method.name), ['Main', '.ctor']);
    assert.equal(vm.returnValue, null);
    const receiver = vm.top.returnObject;
    vm.heap.collect();
    assert.equal(vm.heap.get(receiver).type, 'Point');
    vm.stop();
    assert.equal(vm.frames.length, 0);
    vm.heap.collect();
    assert.throws(() => vm.heap.get(receiver), {name: 'InvalidReferenceException'});
    assert.equal(vm.heap.records.some(record => record?.kind === 'box' && record.type === 'Point'), false);
  });
});
