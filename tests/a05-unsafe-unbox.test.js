import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, memoryMethodDefinition, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {boxValue} from '../packages/runtime/src/execution/boxing.js';
import {memoryCall} from '../packages/runtime/src/execution/memory-calls.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

const point = {name: 'Point', base: 'System.ValueType', flags: 0x100109,
  fields: [{name: 'X', type: 'int'}, {name: 'Tiny', type: 'byte'}], methods: []};
const choice = {name: 'Choice', base: 'System.Enum', flags: 0x101,
  fields: [{name: 'value__', type: 'int', flags: 0x606}], methods: []};
const descriptor = type => ({kind: 'method', owner: 'System.Runtime.CompilerServices.Unsafe', name: 'Unbox',
  signature: {isStatic: true, returnType: '!!0&', parameters: ['object'], genericArity: 1}, genericArguments: [type]});
const unbox = (context, type) => context.methodSpec(
  context.member('System.Runtime.CompilerServices.Unsafe', 'Unbox', '!!0&', ['object'], true, {genericArity: 1}), [type]);

function fixture(body, {result = 'void', locals = ['valuetype Point', 'object', 'valuetype Point&', 'valuetype Point']} = {}) {
  return genericCallFixture([point, {...point, name: 'Other'}, choice,
    {name: 'Program', methods: [{name: 'Main', body, result, locals}]}]);
}

test('Unsafe.Unbox admits the exact SDK8 MethodSpec contract and rejects neighboring signatures', () => {
  const actual = descriptor('Point');
  assert.equal(memoryMethodDefinition(actual)?.operation, 'unboxReference');
  for (const modify of [
    item => item.owner = 'Other.Unsafe', item => item.name = 'UnboxAny', item => item.signature.isStatic = false,
    item => item.signature.returnType = '!!0', item => item.signature.parameters = ['int'],
    item => item.signature.parameters = ['object', 'int'], item => item.signature.genericArity = 2,
    item => item.signature.callingConvention = 5, item => item.signature.explicitThis = true,
    item => item.signature.sentinel = 0, item => item.genericArguments = ['int*'],
    item => item.genericArguments = ['void'], item => delete item.genericArguments
  ]) {
    const invalid = structuredClone(actual);
    modify(invalid);
    assert.equal(memoryMethodDefinition(invalid), null);
  }
});

test('a real MethodSpec returns a mutable struct box interior without changing original and copied values', () => {
  const bytes = fixture((writer, context) => {
    const type = context.resolve('Point'), x = context.fields.get('Point.X'), tiny = context.fields.get('Point.Tiny');
    const print = context.member('System.Console', 'WriteLine', 'void', ['int']);
    writer.op('ldloca.s', 0).op('ldc.i4.7').op('stfld', x).op('ldloc.0').op('box', type).op('stloc.1');
    writer.op('ldloc.1').op('call', unbox(context, 'valuetype Point')).op('stloc.2');
    writer.op('ldloc.2').op('ldc.i4.s', 9).op('stfld', x);
    writer.op('ldloc.2').op('ldc.i4', 511).op('stfld', tiny);
    writer.op('ldloc.1').op('unbox.any', type).op('stloc.3').op('ldloca.s', 3).op('ldc.i4.s', 11).op('stfld', x);
    writer.op('ldloc.0').op('ldfld', x).op('call', print);
    writer.op('ldloc.1').op('unbox.any', type).op('ldfld', x).op('call', print);
    writer.op('ldloc.3').op('ldfld', x).op('call', print);
    writer.op('ldloc.2').op('ldfld', tiny).op('call', print).op('ret');
  });
  const inspector = new AssemblyInspector(bytes);
  assert.equal(inspector.resolveToken(0x2b000001).signature.returnType, '!!0&');
  const verified = verifyCilAssembly(inspector);
  assert.equal(verified.success, true, JSON.stringify(verified.issues));
  const vm = new CilVirtualMachine(inspector);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '7\n9\n11\n255\n');
  } finally { vm.stop(); }
});

test('Unsafe.Unbox retains enum-underlying compatibility while preserving box identity', () => {
  for (const [boxed, requested] of [['Choice', 'int'], ['System.Int32', 'valuetype Choice']]) {
    const bytes = fixture((writer, context) => {
      writer.op('ldc.i4.7').op('box', context.resolve(boxed)).op('stloc.0');
      writer.op('ldloc.0').op('call', unbox(context, requested)).op('ldc.i4.s', 29).op('stind.i4');
      writer.op('ldloc.0').op('unbox.any', context.resolve(boxed)).op('ret');
    }, {result: 'int', locals: ['object']});
    const vm = new CilVirtualMachine(bytes);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.returnValue, 29);
    } finally { vm.stop(); }
  }
});

test('Unsafe.Unbox faults for null, an inexact struct, wrong primitive width and invalid generic constraints', () => {
  for (const [requested, expected, nullValue] of [
    ['valuetype Point', 'NullReferenceException', true], ['valuetype Other', 'InvalidCastException', false],
    ['long', 'InvalidCastException', false], ['object', 'ArgumentException', false],
    ['valuetype System.Nullable`1<int>', 'ArgumentException', false]
  ]) {
    const bytes = fixture((writer, context) => {
      if (nullValue) writer.op('ldnull');
      else if (requested === 'long') writer.op('ldc.i4.7').op('box', context.resolve('System.Int32'));
      else writer.op('ldloc.0').op('box', context.resolve('Point'));
      writer.op('call', unbox(context, requested)).op('pop').op('ret');
    });
    const vm = new CilVirtualMachine(bytes);
    try {
      const result = vm.run();
      assert.equal(result.state, 'faulted', requested);
      assert.equal(result.fault.name, expected, requested + ': ' + result.fault.message);
    } finally { vm.stop(); }
  }
});

test('Unsafe.Unbox interiors alone retain owned boxes across GC and snapshot replay then expire after retirement', () => {
  const bytes = fixture((writer, context) => {
    writer.op('ldloc.0').op('box', context.resolve('Point')).op('call', unbox(context, 'valuetype Point')).op('stloc.1');
    writer.op('call', context.member('System.GC', 'Collect', 'void'));
    writer.op('ldloc.1').op('ldc.i4.s', 23).op('stfld', context.fields.get('Point.X'));
    writer.op('ldloc.1').op('ldfld', context.fields.get('Point.X')).op('ret');
  }, {result: 'int', locals: ['valuetype Point', 'valuetype Point&']});
  const vm = new CilVirtualMachine(bytes), foreign = new CilVirtualMachine(bytes);
  try {
    for (let index = 0; index < 4; index++) vm.step();
    const address = vm.top.locals[1], snapshot = vm.snapshot();
    assert.equal(address.kind, 'box');
    assert(Object.isFrozen(address));
    const foreignBox = boxValue(foreign, foreign.top.locals[0], 'Point');
    assert.deepEqual(foreignBox, address.owner, 'colliding handle/generation shapes do not transfer heap authority');
    assert.throws(() => memoryCall(vm, descriptor('Point'), [foreignBox]), {name: 'InvalidReferenceException'});
    assert.throws(() => memoryCall(vm, descriptor('Point'), [Object.freeze({...address.owner})]), {name: 'InvalidReferenceException'});
    assert.equal(vm.run().returnValue, 23);
    assert(vm.heap.stats.collections > 0);
    vm.restore(snapshot);
    vm.heap.collect();
    assert.equal(vm.dereference(address).fields[0], 0);
    assert.equal(vm.run().returnValue, 23);
    vm.stop();
    vm.heap.collect();
    assert.throws(() => vm.dereference(address), {name: 'InvalidReferenceException'});
  } finally { vm.stop(); foreign.stop(); }
});
