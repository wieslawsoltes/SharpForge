import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {ManagedFault} from '../packages/runtime/src/heap.js';
import {constructBoundDelegate, delegateMethodPointer} from '../packages/runtime/src/execution/delegate-targets.js';
import {registerAsyncContinuation} from '../packages/runtime/src/execution/async-continuations.js';
import {managedFixture} from './managed-fixtures.js';

test('fault completion retains a managed delegate through every allocation and delivers it once', () => {
  const assembly = managedFixture({methods: [
    {name: 'Main', body: (writer, context) => writer.op('ldftn', context.methods.Callback).op('pop').op('ret')},
    {name: 'Callback', parameters: ['string'], body: (writer, context) => writer.op('ldarg.0')
      .op('call', context.member('System.Console', 'WriteLine', 'void', ['string'])).op('ret')}
  ]});
  const vm = new CilVirtualMachine(assembly, {virtualTime: true});
  assert.equal(vm.run().state, 'terminated');
  const task = vm.scheduler.createTask();
  const text = vm.heap.string('retained delegate');
  const delegate = constructBoundDelegate(vm, 'System.Action', text, delegateMethodPointer(vm, 0x06000002));
  registerAsyncContinuation(vm.scheduler, task, Object.freeze({kind: 'delegate', receiver: delegate}));
  vm.heap.collect();
  vm.heap.allocationObserver = {allocation() { vm.heap.collect(); }};
  vm.scheduler.complete(task, null, new ManagedFault('Exception', 'fault'));
  const result = vm.run();
  assert.equal(result.state, 'terminated');
  assert.equal(result.output, 'retained delegate\n');
  vm.scheduler.complete(task, null, new ManagedFault('Exception', 'duplicate'));
  assert.equal(vm.run().state, 'terminated');
  assert.equal(vm.run().output, 'retained delegate\n');
});

test('managed TaskAwaiter.OnCompleted owns its callback through fault-completion collection', () => {
  const taskType = 'System.Threading.Tasks.Task', awaiterType = 'System.Runtime.CompilerServices.TaskAwaiter';
  const assembly = managedFixture({methods: [
    {name: 'Main', locals: ['valuetype ' + awaiterType], body(writer, context) {
      writer.op('ldc.i4.m1').op('call', context.member(taskType, 'Delay', taskType, ['int']))
        .op('callvirt', context.member(taskType, 'GetAwaiter', 'valuetype ' + awaiterType, [], false)).op('stloc.0')
        .op('ldloca.s', 0).op('ldnull').op('ldftn', context.methods.Callback)
        .op('newobj', context.member('System.Action', '.ctor', 'void', ['object', 'nint'], false))
        .op('call', context.member(awaiterType, 'OnCompleted', 'void', ['System.Action'], false)).op('ret');
    }},
    {name: 'Callback', body: (writer, context) => writer.op('ldstr', 0x70000000 + context.md.userString('managed callback'))
      .op('call', context.member('System.Console', 'WriteLine', 'void', ['string'])).op('ret')}
  ]});
  const vm = new CilVirtualMachine(assembly, {virtualTime: true});
  assert.equal(vm.run().state, 'terminated');
  const task = [...vm.scheduler.tasks.values()].find(value => value.status === 'waiting');
  assert.ok(task);
  assert.equal(task.continuations.length, 1);
  vm.heap.collect();
  const pins = [...vm.heap.pins];
  vm.heap.allocationObserver = {allocation() { vm.heap.collect(); }};
  vm.scheduler.complete(task, null, new ManagedFault('Exception', 'fault'));
  assert.deepEqual(vm.heap.pins, pins);
  const result = vm.run();
  assert.equal(result.state, 'terminated');
  assert.equal(result.output, 'managed callback\n');
  assert.deepEqual(task.continuations, []);
});
