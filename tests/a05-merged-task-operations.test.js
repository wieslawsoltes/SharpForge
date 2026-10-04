import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {invokeAsyncIntrinsic} from '../packages/runtime/src/execution/async-runtime.js';
import {faultFromException} from '../packages/runtime/src/execution/exception-object.js';
import {aggregateInnerList, exceptionListCall, flattenAggregate} from '../packages/runtime/src/execution/aggregate-exception.js';
import {managedFixture} from './managed-fixtures.js';

const taskType = 'System.Threading.Tasks.Task';
const awaiterType = 'System.Runtime.CompilerServices.TaskAwaiter`1<int>';
const descriptor = (owner, name, returnType, parameters = [], isStatic = false) => ({
  kind: 'method', owner, name, signature: {kind: 'method', isStatic, returnType, parameters}
});

test('merged CIL Task.Delay executes the infinite, zero, and full Int32 boundary contracts', () => {
  const assembly = managedFixture({methods: [{name: 'Main', body(writer, context) {
    for (const duration of [-1, 0, 2147483647]) {
      writer.op('ldc.i4', duration).op('call', context.member(taskType, 'Delay', taskType, ['int']))
        .op('callvirt', context.member(taskType, 'get_IsCompleted', 'bool', [], false))
        .op('call', context.member('System.Console', 'WriteLine', 'void', ['bool']));
    }
    writer.op('ret');
  }}]});
  const vm = new CilVirtualMachine(assembly, {virtualTime: true});
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.output, 'False\nTrue\nFalse\n');
  const pending = [...vm.scheduler.tasks.values()].filter(task => task.status === 'waiting');
  assert.equal(pending.length, 2);
  assert.equal(pending.filter(task => task.deadline === undefined).length, 1);
  assert.equal(pending.find(task => task.deadline !== undefined).deadline, 2147483647);
  const delay = descriptor(taskType, 'Delay', taskType, ['int'], true);
  for (const duration of [-2, 2147483648]) {
    assert.throws(() => invokeAsyncIntrinsic(vm, delay, [duration]), {name: 'ArgumentOutOfRangeException'});
  }
});

test('merged Task Wait and Result wrap the original fault while await preserves its reference', () => {
  const vm = new CilVirtualMachine(managedFixture({methods: [{name: 'Main', body: writer => writer.op('ret')}]}));
  assert.equal(vm.run().state, 'terminated');
  const message = vm.heap.string('original');
  const reference = vm.heap.allocate('exception', 'System.InvalidOperationException', [message], [message]);
  const original = new ManagedFault('System.InvalidOperationException', 'original', reference);
  const task = vm.scheduler.createTask('int');
  vm.scheduler.complete(task, null, original);
  vm.heap.allocationObserver = {allocation() { vm.heap.collect(); }};
  vm.heap.withRoots([task.ref, reference], () => {
    for (const call of [descriptor(taskType, 'Wait', 'void'), descriptor(taskType + '`1<int>', 'get_Result', 'int')]) {
      assert.throws(() => invokeAsyncIntrinsic(vm, call, [task.ref]), error => vm.heap.withRoots([error.reference], () => {
        assert.equal(error.name, 'System.AggregateException');
        assert.equal(vm.heap.get(error.reference).data[1], reference);
        assert.equal(faultFromException(vm, reference).message, 'original');
        const list = aggregateInnerList(vm, error.reference);
        assert.equal(exceptionListCall(vm, list, 'get_Count', []), 1);
        assert.equal(exceptionListCall(vm, list, 'get_Item', [0]), reference);
        const flattened = flattenAggregate(vm, error.reference);
        const flattenedList = aggregateInnerList(vm, flattened);
        assert.equal(exceptionListCall(vm, flattenedList, 'get_Count', []), 1);
        assert.equal(exceptionListCall(vm, flattenedList, 'get_Item', [0]), reference);
        return true;
      }));
    }
    const awaiter = invokeAsyncIntrinsic(vm, descriptor(taskType + '`1<int>', 'GetAwaiter', awaiterType), [task.ref]).value;
    assert.throws(() => invokeAsyncIntrinsic(vm, descriptor(awaiterType, 'GetResult', 'int'), [awaiter]), error => error === original);
  });
});

test('merged completion keeps suspended state-machine waiters unwrapped beside aggregate-mode waiters', () => {
  const vm = new CilVirtualMachine(managedFixture({methods: [{name: 'Main', body: writer => writer.op('ret')}]}));
  const scheduler = vm.scheduler;
  const task = scheduler.createTask();
  const awaited = {id: 10, status: 'waiting', frames: [], wait: {task: task.ref, pushResult: false, propagateFault: false}};
  const blocked = {id: 11, status: 'waiting', frames: [], wait: {task: task.ref, pushResult: false, failureMode: 'aggregate'}};
  scheduler.contexts.set(10, awaited);
  scheduler.contexts.set(11, blocked);
  task.waiters.add(10);
  task.waiters.add(11);
  scheduler.complete(task, null, new ManagedFault('System.Exception', 'failure'));
  assert.equal(awaited.status, 'ready');
  assert.equal(awaited.resumeFault, undefined);
  assert.equal(blocked.status, 'ready');
  assert.equal(blocked.resumeFault.name, 'System.AggregateException');
  assert.equal(task.waiters.size, 0);
});
