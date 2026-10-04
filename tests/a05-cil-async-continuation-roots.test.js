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
  assert.equal(vm.run().state, 'terminated');
  assert.equal(vm.output, 'retained delegate\n');
  vm.scheduler.complete(task, null, new ManagedFault('Exception', 'duplicate'));
  assert.equal(vm.run().state, 'terminated');
  assert.equal(vm.output, 'retained delegate\n');
});
