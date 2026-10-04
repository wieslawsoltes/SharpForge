import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {parseSignatureType, methodSignature, managedDelegateSignature, supportedDelegateCall} from '@sharpforge/cil';
import {frameworkType} from '@sharpforge/framework';
import {managedFixture} from './managed-fixtures.js';
import {
  delegateMethodPointer, constructBoundDelegate, boundDelegatesEqual, boundDelegateCall
} from '../packages/runtime/src/execution/delegate-targets.js';

function member(context, owner, name, result, parameters = []) {
  const type = context.md.typeSpec(parseSignatureType(owner, context.resolve));
  return context.md.member(type, name, methodSignature(result, parameters, false, context.resolve));
}

function fixture(mode = 'closed-static-null') {
  return managedFixture({methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      for (const name of ['Bound', 'Instance', 'Integer']) writer.op('ldftn', context.methods[name]).op('pop');
      const instance = mode.startsWith('open-instance') || mode === 'closed-instance';
      const open = mode.startsWith('open-');
      const type = open ? `System.Func\`2<${instance ? 'Fixture.Program' : 'string'},int>` : 'System.Func`1<int>';
      if (mode === 'closed-instance') writer.op('newobj', context.methods['.ctor']);
      else if (mode === 'closed-static-string') writer.op('ldstr', 0x70000000 + context.md.userString('bound'));
      else writer.op('ldnull');
      writer.op('ldftn', context.methods[instance ? 'Instance' : 'Bound']);
      writer.op('newobj', member(context, type, '.ctor', 'void', ['object', 'nint']));
      if (open) {
        if (instance && mode !== 'open-instance-null') writer.op('newobj', context.methods['.ctor']);
        else writer.op('ldnull');
      }
      writer.op('callvirt', member(context, type, 'Invoke', 'int', open ? [instance ? 'Fixture.Program' : 'string'] : []));
      writer.op('ret');
    }},
    {name: 'Bound', result: 'int', parameters: ['string'], body: writer => writer.op('ldarg.0')
      .op('brtrue', 'text').op('ldc.i4', 42).op('ret').mark('text').op('ldc.i4.7').op('ret')},
    {name: 'Instance', static: false, result: 'int', body: writer => writer.op('ldc.i4', 17).op('ret')},
    {name: 'Integer', result: 'int', parameters: ['int'], body: writer => writer.op('ldarg.0').op('ret')},
    {name: '.ctor', static: false, body: (writer, context) => writer.op('ldarg.0')
      .op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret')}
  ]});
}

for (const [mode, result] of [
  ['closed-static-null', 42], ['closed-static-string', 7], ['open-static', 42],
  ['closed-instance', 17], ['open-instance', 17]
]) {
  test('direct CIL delegate binding: ' + mode, () => {
    const actual = new CilVirtualMachine(fixture(mode)).run();
    assert.equal(actual.state, 'terminated', actual.fault?.message);
    assert.equal(actual.returnValue, result);
  });
}

test('open instance invocation rejects a null receiver at the existing call gate', () => {
  const result = new CilVirtualMachine(fixture('open-instance-null')).run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'NullReferenceException');
});

test('delegate equality compares canonical target method, type, receiver and binding', () => {
  const vm = new CilVirtualMachine(fixture());
  const pointer = delegateMethodPointer(vm, 0x06000002);
  const first = constructBoundDelegate(vm, 'System.Func`1<int>', null, pointer);
  const same = constructBoundDelegate(vm, 'System.Func`1<int>', null, delegateMethodPointer(vm, 0x06000002));
  const text = constructBoundDelegate(vm, 'System.Func`1<int>', vm.heap.string('bound'), pointer);
  const open = constructBoundDelegate(vm, 'System.Func`2<string,int>', null, pointer);
  assert.equal(boundDelegatesEqual(vm, first, same), true);
  assert.equal(boundDelegatesEqual(vm, first, text), false);
  assert.equal(boundDelegatesEqual(vm, first, open), false);
  assert.equal(boundDelegatesEqual(vm, first, vm.heap.string('not a delegate')), false);
  assert.equal(boundDelegatesEqual(vm, first, null), false);
  assert.equal(boundDelegatesEqual(vm, null, null), true);
  assert.equal(vm.platform.delegateEquals(first, same), true);
  assert.equal(boundDelegatesEqual(vm, open, vm.platform.delegate('System.Func`2<string,int>', pointer.token, null)), true);
});

test('static target type, value binding and foreign pointer failures precede allocation', () => {
  const vm = new CilVirtualMachine(fixture());
  const foreign = new CilVirtualMachine(fixture());
  const pointer = delegateMethodPointer(vm, 0x06000002);
  const wrongReceiver = vm.heap.object('object', []);
  const before = vm.heap.stats.allocations;
  for (const action of [
    () => constructBoundDelegate(vm, 'System.Func`1<int>', wrongReceiver, pointer),
    () => constructBoundDelegate(vm, 'System.Func`1<int>', null, delegateMethodPointer(vm, 0x06000004)),
    () => constructBoundDelegate(vm, 'System.Func`1<int>', null, delegateMethodPointer(foreign, 0x06000002)),
    () => constructBoundDelegate(vm, 'System.Func`1<string>', null, pointer)
  ]) assert.throws(action, {name: 'ArgumentException'});
  assert.equal(vm.heap.stats.allocations, before);
});

test('scheduled delegates use the same closed-static arguments and snapshot identity', () => {
  const vm = new CilVirtualMachine(fixture());
  const delegate = constructBoundDelegate(vm, 'System.Func`1<int>', null, delegateMethodPointer(vm, 0x06000002));
  const task = vm.scheduler.createTask('int');
  const id = vm.scheduler.enqueue(delegate, [], {task});
  assert.deepEqual(vm.scheduler.contexts.get(id).frames[0].args, [null]);
  const snapshot = vm.snapshot();
  vm.platform.set(delegate, 'mode', 'static');
  vm.restore(snapshot);
  assert.deepEqual(boundDelegateCall(vm, delegate, []).arguments, [null]);
  assert.deepEqual(vm.scheduler.contexts.get(id).frames[0].args, [null]);
  assert.throws(() => boundDelegateCall(vm, delegate, [1]), {name: 'ArgumentException'});
  assert.throws(() => boundDelegateCall(vm, null, []), {name: 'NullReferenceException'});
});

test('guest Equals uses the same identity and verifier rejects malformed Invoke signatures', () => {
  const assembly = managedFixture({methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      for (let index = 0; index < 2; index++) writer.op('ldnull').op('ldftn', context.methods.Target)
        .op('newobj', context.member('System.Func`1<int>', '.ctor', 'void', ['object', 'nint'], false));
      writer.op('callvirt', context.member('System.Func`1<int>', 'Equals', 'bool', ['object'], false)).op('ret');
    }},
    {name: 'Target', result: 'int', body: writer => writer.op('ldc.i4.1').op('ret')}
  ]});
  const vm = new CilVirtualMachine(assembly);
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.returnValue, 1);
  assert.equal(supportedDelegateCall(vm.inspector, {owner: 'System.Func`1<int>', name: 'Invoke',
    signature: {isStatic: true, parameters: [], returnType: 'int'}}), false);
  assert.equal(supportedDelegateCall(vm.inspector, {owner: 'System.Func`1<int>', name: '.ctor',
    signature: {isStatic: false, parameters: ['object', 'int'], returnType: 'void'}}), false);
});

const standardDelegate = (family, arity, count = arity) => `System.${family}\`${arity}<${Array(count).fill('int').join(',')}>`;

for (const [owner, parameters, returnType] of [
  ['System.Action', [], 'void'],
  [standardDelegate('Action', 1), ['int'], 'void'],
  [standardDelegate('Action', 16), Array(16).fill('int'), 'void'],
  [standardDelegate('Func', 1), [], 'int'],
  [standardDelegate('Func', 17), Array(16).fill('int'), 'int']
]) {
  test('public delegate profile accepts CLR arity boundary: ' + owner, () => {
    const signature = {isStatic: false, parameters, returnType};
    assert.deepEqual(managedDelegateSignature(null, owner), signature);
    assert.equal(supportedDelegateCall(null, {owner, name: 'Invoke', signature}), true);
  });
}

for (const owner of [
  'System.Action`0', 'System.Action`0<>', standardDelegate('Action', 17), standardDelegate('Func', 18),
  'System.Func', 'System.Func`0', 'System.Func`0<>', 'System.Func`01<int>', 'System.Action`x<int>',
  'System.Action`-1<int>', 'System.Action`1<>', 'System.Func`1', 'System.Action<int>',
  standardDelegate('Func', 2, 1), standardDelegate('Func', 1, 2), standardDelegate('Action', 2, 1)
]) {
  test('public delegate profile rejects malformed or out-of-range arity: ' + owner, () => {
    assert.equal(managedDelegateSignature(null, owner), null);
    assert.equal(supportedDelegateCall(null, {owner, name: '.ctor',
      signature: {isStatic: false, parameters: ['object', 'nint'], returnType: 'void'}}), false);
  });
}

test('registered framework canonicalization cannot bypass the standard delegate arity guard', () => {
  const malformed = 'System.Func`2<int>';
  assert.equal(frameworkType(malformed)?.name, 'System.Func`1<int>');
  assert.equal(managedDelegateSignature(null, malformed), null);
  assert.deepEqual(managedDelegateSignature(null, 'System.Func`1<int>'),
    {isStatic: false, parameters: [], returnType: 'int'});
});
