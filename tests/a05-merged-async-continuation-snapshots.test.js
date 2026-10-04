import test from 'node:test';
import assert from 'node:assert/strict';
import {asyncStateMachine} from '@sharpforge/cil';
import {CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {ManagedFault} from '../packages/runtime/src/execution/managed-fault.js';
import {constructBoundDelegate, delegateMethodPointer} from '../packages/runtime/src/execution/delegate-targets.js';
import {combineDelegates} from '../packages/runtime/src/execution/delegate-invocations.js';
import {registerAsyncContinuation} from '../packages/runtime/src/execution/async-continuations.js';
import {createValue} from '../packages/runtime/src/execution/value-types.js';
import {boxValue} from '../packages/runtime/src/execution/boxing.js';
import {managedFixture} from './managed-fixtures.js';
import {asyncFixture} from './support/async-fixture.js';

function callbackFixture() {
  return managedFixture({methods: [
    {name: 'Main', body: (writer, context) => writer.op('ldftn', context.methods.Callback).op('pop').op('ret')},
    {name: 'Callback', parameters: ['string'], body: (writer, context) => writer.op('ldarg.0')
      .op('call', context.member('System.Console', 'WriteLine', 'void', ['string'])).op('ret')}
  ]});
}

function pending(assembly = callbackFixture()) {
  const vm = new CilVirtualMachine(assembly, {virtualTime: true, weakStringInterning: true});
  assert.equal(vm.run().state, 'terminated');
  const task = vm.scheduler.createTask();
  const first = constructBoundDelegate(vm, 'System.Action', vm.heap.string('first'), delegateMethodPointer(vm, 0x06000002));
  const second = constructBoundDelegate(vm, 'System.Action', vm.heap.string('second'), delegateMethodPointer(vm, 0x06000002));
  const combined = combineDelegates(vm, first, second);
  const entry = Object.freeze({kind: 'delegate', receiver: combined});
  // Two registrations of the same multicast callback are distinct work, not an identity set.
  registerAsyncContinuation(vm.scheduler, task, entry);
  registerAsyncContinuation(vm.scheduler, task, entry);
  return {vm, task, assembly};
}

function completeWithFault(vm, id) {
  const task = vm.scheduler.tasks.get(id);
  const message = vm.heap.string('original fault');
  const reference = vm.heap.allocate('exception', 'System.Exception', [message], [message]);
  const error = new ManagedFault('System.Exception', 'original fault', reference);
  // Keep a terminal task reachable so its captured $exception is a live managed root.
  vm.heap.createHandle(task.ref);
  vm.heap.allocationObserver = {allocation() { vm.heap.collect(); }};
  vm.scheduler.complete(task, null, error);
  assert.equal(vm.platform.get(task.ref, '$exception'), reference);
  assert.deepEqual(task.continuations, []);
  return task;
}

const expected = 'first\nsecond\nfirst\nsecond\n';

test('task-owned multicast callbacks survive captured-only local and portable restore and fault delivery exactly once', async () => {
  const {vm, task, assembly} = pending();
  vm.heap.collect();
  const saved = vm.snapshot();
  const repeated = vm.snapshot();
  const captured = saved.scheduler.tasks.find(([id]) => id === task.id)[1];
  assert.equal(captured.continuations[0], captured.continuations[1]);
  assert(Object.isFrozen(captured.continuations[0]));
  assert.equal(saved.heap.records[task.ref.h], repeated.heap.records[task.ref.h], 'unchanged records share COW storage');
  const wire = await serializeSnapshot(vm, saved, {json: true});
  const receiver = task.continuations[0].receiver;
  vm.stop();
  vm.heap.collect();
  assert.throws(() => vm.heap.get(receiver), /reference|collected|generation/i);
  vm.restore(saved);
  const fresh = new CilVirtualMachine(assembly, {virtualTime: true, weakStringInterning: true});
  await restoreSerializedSnapshot(fresh, wire);
  for (const replay of [vm, fresh]) {
    const restored = completeWithFault(replay, task.id);
    assert.equal(replay.run().output, expected);
    replay.scheduler.complete(restored, null, new ManagedFault('Exception', 'duplicate'));
    assert.equal(replay.run().output, expected);
    assert.deepEqual(restored.continuations, []);
    replay.stop();
  }
});

test('snapshot after detachment retains scheduled callbacks and the original fault without redelivery', async () => {
  const {vm, task, assembly} = pending();
  completeWithFault(vm, task.id);
  const saved = vm.snapshot();
  const wire = await serializeSnapshot(vm, saved);
  const fresh = new CilVirtualMachine(assembly, {virtualTime: true});
  await restoreSerializedSnapshot(fresh, wire);
  vm.stop();
  vm.heap.collect();
  vm.restore(saved);
  for (const replay of [vm, fresh]) {
    const restored = replay.scheduler.tasks.get(task.id);
    assert.equal(restored.error.reference, replay.platform.get(restored.ref, '$exception'));
    replay.heap.collect();
    assert.equal(replay.heap.get(restored.error.reference).type, 'System.Exception');
    assert.deepEqual(restored.continuations, []);
    replay.scheduler.complete(restored);
    assert.equal(replay.run().output, expected);
    replay.stop();
  }
});

test('managed OnCompleted registration survives portable restore before task fault completion', async () => {
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
  assert.equal(task.continuations.length, 1);
  const wire = await serializeSnapshot(vm, vm.snapshot(), {json: true});
  vm.stop();
  vm.heap.collect();
  const fresh = new CilVirtualMachine(assembly, {virtualTime: true});
  await restoreSerializedSnapshot(fresh, wire);
  const restored = completeWithFault(fresh, task.id);
  assert.equal(fresh.run().output, 'managed callback\n');
  fresh.scheduler.complete(restored);
  assert.equal(fresh.run().output, 'managed callback\n');
  fresh.stop();
});

test('malformed task-owned callback state rejects atomically before replacing any live execution state', () => {
  const {vm, task} = pending();
  const frames = vm.frames, records = vm.heap.records, tasks = vm.scheduler.tasks;
  const wrongReceiver = vm.heap.string('not a delegate');
  for (const mutate of [
    value => { value.continuations = {}; },
    value => { value.continuations = Array(vm.scheduler.maxContexts + 1).fill(value.continuations[0]); },
    value => { value.continuations[0] = {...value.continuations[0]}; },
    value => { value.continuations[0] = Object.freeze({...value.continuations[0], kind: 'host'}); },
    value => { value.continuations[0] = Object.freeze({kind: 'delegate', receiver: wrongReceiver}); },
    value => { value.status = 'completed'; }
  ]) {
    const saved = vm.snapshot();
    mutate(saved.scheduler.tasks.find(([id]) => id === task.id)[1]);
    assert.throws(() => vm.restore(saved), /async continuation/);
    assert.equal(vm.frames, frames);
    assert.equal(vm.heap.records, records);
    assert.equal(vm.scheduler.tasks, tasks);
  }
  vm.stop();
});

test('captured delegate method tokens must remain verified and match the zero-argument callback signature', async () => {
  const {vm, task} = pending();
  const records = vm.heap.records, tasks = vm.scheduler.tasks;
  for (const token of [0x0600ffff, 0x06000001]) {
    const saved = vm.snapshot();
    const callback = saved.heap.records[task.continuations[0].receiver.h];
    const list = callback.data[callback.data.indexOf('invocationList') + 1];
    const leaf = saved.heap.records[list.h].data[0];
    const original = saved.heap.records[leaf.h], data = [...original.data];
    data[data.indexOf('method') + 1] = token;
    saved.heap.records[leaf.h] = {...original, data};
    assert.throws(() => vm.restore(saved), /async continuation/);
    await assert.rejects(serializeSnapshot(vm, saved), /async continuation/);
    assert.equal(vm.heap.records, records);
    assert.equal(vm.scheduler.tasks, tasks);
  }
  vm.stop();
});

function registrationVM(assembly) {
  const vm = new CilVirtualMachine(assembly, {virtualTime: true});
  const task = vm.scheduler.createTask();
  const descriptor = asyncStateMachine(vm.inspector, 'Machine');
  const table = vm.typeSystem.table('Machine');
  const receiver = boxValue(vm, createValue(vm, table), 'Machine');
  const continuation = Object.freeze({kind: 'machine', type: 'Machine', method: descriptor.moveNext, receiver});
  task.asyncMachine = continuation;
  vm.call(descriptor.setStateMachine, [vm.address('box', 0, receiver), receiver], {
    asyncRegistration: Object.freeze({task: task.ref, continuation})
  });
  return {vm, task, descriptor};
}

test('optional SetStateMachine return handshake retains its shared machine and registers once after local or portable restore', async () => {
  const assembly = asyncFixture();
  const {vm, task} = registrationVM(assembly);
  const saved = vm.snapshot();
  const capturedTask = saved.scheduler.tasks.find(([id]) => id === task.id)[1];
  assert.equal(saved.frames.at(-1).asyncRegistration.continuation, capturedTask.asyncMachine);
  const wire = await serializeSnapshot(vm, saved);
  vm.stop();
  vm.heap.collect();
  vm.restore(saved);
  const fresh = new CilVirtualMachine(assembly, {virtualTime: true});
  await restoreSerializedSnapshot(fresh, wire);
  for (const replay of [vm, fresh]) {
    const restored = replay.scheduler.tasks.get(task.id);
    const registration = replay.top.asyncRegistration;
    replay.heap.collect();
    replay.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    assert.deepEqual(restored.continuations, [registration.continuation]);
    assert.equal(restored.asyncMachine, registration.continuation);
    assert(replay.frames.every(frame => frame.asyncRegistration === undefined));
    replay.stop();
    assert.deepEqual(restored.continuations, []);
    assert.equal(restored.asyncMachine, null);
  }
});

test('forged registration and machine metadata reject before touching live roots', () => {
  const {vm, task, descriptor} = registrationVM(asyncFixture());
  const records = vm.heap.records, frames = vm.frames;
  for (const mutate of [
    saved => { saved.frames.at(-1).asyncRegistration = {...saved.frames.at(-1).asyncRegistration}; },
    saved => { saved.frames.at(-1).args[1] = task.ref; },
    saved => {
      const value = saved.scheduler.tasks.find(([id]) => id === task.id)[1];
      value.asyncMachine = Object.freeze({...value.asyncMachine, method: descriptor.setStateMachine});
    },
    saved => {
      const value = saved.scheduler.tasks.find(([id]) => id === task.id)[1];
      value.asyncState = {kind: 'task', builderType: 'System.Runtime.CompilerServices.AsyncTaskMethodBuilder',
        machine: null, moveNext: null, contextId: null, awaitedTask: null, phase: 'created'};
    }
  ]) {
    const saved = vm.snapshot();
    mutate(saved);
    assert.throws(() => vm.restore(saved), /async continuation/);
    assert.equal(vm.heap.records, records);
    assert.equal(vm.frames, frames);
  }
  vm.stop();
});
