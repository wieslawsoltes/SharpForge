import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';
import {constructDelegate, delegatesEqual, invokeDelegateOperation} from '../packages/runtime/src/execution/delegates.js';
import {methodPointer} from '../packages/runtime/src/execution/calls.js';

function fixture() {
  return controlFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      writer.op('ldnull').op('ldftn', context.methods.get('Program.Bound'));
      writer.op('newobj', context.member('System.Func`1<int>', '.ctor', 'void', ['object', 'nint'], false));
      writer.op('callvirt', context.member('System.Func`1<int>', 'Invoke', 'int', [], false)).op('ret');
    }},
    {name: 'Bound', result: 'int', parameters: ['string'], body: writer => writer.op('ldarg.0')
      .op('brtrue', 'nonNull').op('ldc.i4', 42).op('ret').label('nonNull').op('ldc.i4.1').op('ret')}
  ]}]);
}

test('T02.5 a closed static delegate can bind null to its first reference argument', () => {
  const result = new CilVirtualMachine(fixture()).run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.returnValue, 42);
});

test('T02.5 Equals compares target, method, binding and ordered invocation list', () => {
  const vm = new CilVirtualMachine(fixture());
  const pointer = methodPointer(vm, 0x06000002);
  const first = constructDelegate(vm, 'System.Func`1<int>', null, pointer);
  const equivalent = constructDelegate(vm, 'System.Func`1<int>', null, methodPointer(vm, 0x06000002));
  const distinct = constructDelegate(vm, 'System.Func`1<int>', vm.heap.string('bound'), pointer);
  assert.equal(delegatesEqual(vm, first, equivalent), true);
  assert.equal(delegatesEqual(vm, first, distinct), false);
  const descriptor = {name: 'Equals'};
  assert.equal(invokeDelegateOperation(vm, descriptor, [first, equivalent]), 1);
  assert.equal(invokeDelegateOperation(vm, descriptor, [first, distinct]), 0);
  assert.equal(invokeDelegateOperation(vm, descriptor, [first, null]), 0);
  assert.equal(invokeDelegateOperation(vm, descriptor, [first, vm.heap.string('not a delegate')]), 0);
});

test('T02.5 mismatched closed-static target type is rejected before invocation', () => {
  const vm = new CilVirtualMachine(fixture());
  const object = vm.heap.object(vm.typeSystem.table('System.Object'), []);
  assert.throws(() => constructDelegate(vm, 'System.Func`1<int>', object, methodPointer(vm, 0x06000002)),
    {name: 'ArgumentException'});
});
