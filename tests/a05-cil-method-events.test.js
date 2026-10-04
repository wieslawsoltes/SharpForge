import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, RuntimeEventName} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

function calls() {
  return managedFixture({methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      writer.op('ldc.i4', 40).op('call', context.methods.Increment).op('call', context.methods.Increment).op('ret');
    }},
    {name: 'Increment', result: 'int', parameters: ['int'],
      body: writer => writer.op('ldarg.0').op('ldc.i4.1').op('add').op('ret')}
  ]});
}

test('T10.2 opt-in CIL method events preserve results and report calls in order', () => {
  const assembly = calls();
  const plain = new CilVirtualMachine(assembly), observed = new CilVirtualMachine(assembly, {runtimeEvents: true});
  const received = [], dispose = observed.runtimeEvents.subscribe(event => received.push(event), {replay: true});
  try {
    assert.equal(plain.runtimeEvents, null);
    const expected = plain.run(), actual = observed.run();
    assert.equal(actual.state, 'terminated', actual.fault?.message);
    assert.equal(actual.returnValue, 42);
    assert.equal(actual.returnValue, expected.returnValue);
    assert.equal(actual.stats.instructions, expected.stats.instructions);
    assert.deepEqual(received.map(event => event.name), [
      'MethodLoad', 'MethodEnter', 'MethodLoad', 'MethodEnter', 'MethodLeave',
      'MethodEnter', 'MethodLeave', 'MethodLeave'
    ]);
    assert.deepEqual(received.filter(event => event.name === RuntimeEventName.MethodLoad)
      .map(event => event.payload.name), ['Fixture.Program::Main', 'Fixture.Program::Increment']);
    const entries = received.filter(event => event.name === RuntimeEventName.MethodEnter);
    assert.deepEqual(entries.map(event => event.payload.method), [0x06000001, 0x06000002, 0x06000002]);
    assert.equal(new Set(entries.map(event => event.payload.frame)).size, 3);
    assert(received.every((event, index) => index === 0 || event.sequence > received[index - 1].sequence));
  } finally { dispose(); plain.stop(); observed.stop(); }
});

test('T10.2 unhandled first-pass inspection retains open method spans until stop', () => {
  const assembly = managedFixture({methods: [
    {name: 'Main', body: (writer, context) => writer.op('call', context.methods.Fail).op('ret')},
    {name: 'Fail', body: writer => writer.op('ldnull').op('throw')}
  ]});
  const vm = new CilVirtualMachine(assembly, {runtimeEvents: true});
  try {
    assert.equal(vm.run().state, 'faulted');
    assert.equal(vm.frames.length, 2);
    assert.equal(vm.runtimeEvents.read().filter(event => event.name === RuntimeEventName.MethodLeave).length, 0);
    vm.stop();
    const leaves = vm.runtimeEvents.read().filter(event => event.name === RuntimeEventName.MethodLeave);
    assert.deepEqual(leaves.map(event => [event.payload.method, event.payload.reason]),
      [[0x06000002, 'stop'], [0x06000001, 'stop']]);
  } finally { vm.stop(); }
});

test('T10.2 debugger pause flushes host events while keeping the live method open', () => {
  const vm = new CilVirtualMachine(calls(), {runtimeEvents: true}), delivered = [];
  const dispose = vm.runtimeEvents.subscribe(event => delivered.push(event), {replay: true});
  try {
    vm.runSlice({onInstruction: () => true});
    assert.equal(vm.state, 'paused');
    assert.equal(vm.instructions, 0);
    assert.deepEqual(delivered.map(event => event.name), ['MethodLoad', 'MethodEnter']);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 42);
    assert.equal(delivered.at(-1).name, RuntimeEventName.MethodLeave);
  } finally { dispose(); vm.stop(); }
});

test('T10.2 callback failures escape after dispatch and are never managed faults', () => {
  const vm = new CilVirtualMachine(calls(), {runtimeEvents: true}), failure = new Error('host observer');
  const dispose = vm.runtimeEvents.subscribe(() => { throw failure; }, {replay: true});
  try {
    assert.throws(() => vm.run(), error => error === failure);
    assert.equal(vm.state, 'terminated');
    assert.equal(vm.returnValue, 42);
    assert.equal(vm.fault, null);
  } finally { dispose(); vm.stop(); }
});

test('T10.2 snapshots preserve host history and subscriptions while restored spans restart explicitly', () => {
  const vm = new CilVirtualMachine(calls(), {runtimeEvents: true}), observed = [];
  const log = vm.runtimeEvents, dispose = log.subscribe(event => observed.push(event.sequence), {replay: true});
  try {
    vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
    const snapshot = vm.snapshot();
    assert.equal(snapshot.frames.length, 2);
    assert.equal(Object.hasOwn(snapshot, 'runtimeEvents'), false);
    assert.equal(Object.hasOwn(snapshot, 'options'), false);
    assert.equal(vm.options.runtimeEvents, true);
    assert.equal(vm.run().returnValue, 42);
    const sequence = log.sequence, loads = log.read().filter(event => event.name === RuntimeEventName.MethodLoad).length;
    vm.restore(snapshot);
    assert.equal(vm.runtimeEvents, log);
    const resumed = log.read({after: sequence});
    assert(resumed.length > 0 && resumed.every(event => event.payload.reason === 'restore'));
    assert.equal(vm.run().returnValue, 42);
    assert.equal(log.read().filter(event => event.name === RuntimeEventName.MethodLoad).length, loads);
    assert(observed.at(-1) > sequence);
    assert(observed.every((value, index) => index === 0 || value > observed[index - 1]));
    const finalSequence = log.sequence;
    assert.throws(() => vm.restore({...snapshot, owner: {}}), /another CIL VM/);
    assert.equal(log.sequence, finalSequence);
  } finally { dispose(); vm.stop(); }
});

test('T10.2 stop closes open spans once and leaves shutdown complete if a subscriber throws', () => {
  const vm = new CilVirtualMachine(calls(), {runtimeEvents: true});
  const failure = new Error('shutdown observer');
  const dispose = vm.runtimeEvents.subscribe(() => { throw failure; }, {replay: true});
  assert.throws(() => vm.stop(), error => error === failure);
  assert.equal(vm.state, 'terminated');
  assert.equal(vm.frames.length, 0);
  dispose();
  vm.stop();
  const leaves = vm.runtimeEvents.read().filter(event => event.name === RuntimeEventName.MethodLeave);
  assert.deepEqual(leaves.map(event => event.payload.reason), ['stop']);
});

test('T10.2 event capacity is honored and malformed opt-in values reject explicitly', () => {
  const vm = new CilVirtualMachine(calls(), {runtimeEvents: {capacity: 2}});
  try {
    assert.equal(vm.run().returnValue, 42);
    assert.equal(vm.runtimeEvents.read().length, 2);
    assert(vm.runtimeEvents.dropped > 0);
  } finally { vm.stop(); }
  for (const runtimeEvents of [null, 1, 'yes', [], {capacity: 0}]) {
    assert.throws(() => new CilVirtualMachine(calls(), {runtimeEvents}));
  }
});
