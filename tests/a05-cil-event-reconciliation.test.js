import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, RuntimeEventName} from '@sharpforge/runtime';
import {flushCilMethodEvents} from '../packages/runtime/src/execution/cil-method-events.js';
import {managedFixture} from './managed-fixtures.js';

const leaves = vm => vm.runtimeEvents.read().filter(event => event.name === RuntimeEventName.MethodLeave);

function nestedCalls() {
  return managedFixture({methods: [
    {name: 'Main', body: (writer, context) => writer.op('call', context.methods.Parent).op('ret')},
    {name: 'Parent', body: (writer, context) => writer.op('call', context.methods.Child).op('ret')},
    {name: 'Child', body: writer => writer.op('nop').op('ret')}
  ]});
}

function parkedCalls() {
  return managedFixture({methods: [
    {name: 'Main', body: (writer, context) => writer.op('ldnull').op('ldftn', context.methods.Worker)
      .op('newobj', context.member('System.Action', '.ctor', 'void', ['object', 'nint'], false))
      .op('call', context.member('System.Threading.Tasks.Task', 'Run', 'System.Threading.Tasks.Task', ['System.Action']))
      .op('pop').op('ret')},
    {name: 'Worker', body: (writer, context) => writer.op('call', context.methods.Park).op('ret')},
    {name: 'Park', body: (writer, context) => writer.op('ldc.i4', 10)
      .op('call', context.member('System.Threading.Thread', 'Sleep', 'void', ['int'])).op('ret')}
  ]});
}

function exactSpanPayloads(events) {
  for (const event of events) {
    if (![RuntimeEventName.MethodEnter, RuntimeEventName.MethodLeave].includes(event.name)) continue;
    assert.deepEqual(Object.keys(event.payload), ['method', 'frame', 'reason']);
    assert(Object.isFrozen(event.payload));
  }
}

test('an empty active-span map skips frame enumeration while delivering queued manual-step leaves', () => {
  const assembly = managedFixture({methods: [{name: 'Main', body: writer => writer.op('nop').op('ret')}]});
  const vm = new CilVirtualMachine(assembly, {runtimeEvents: true});
  const delivered = [];
  const dispose = vm.runtimeEvents.subscribe(event => delivered.push(event), {replay: true});
  try {
    vm.step();
    vm.step();
    assert.equal(vm.frames.length, 0);
    assert.deepEqual(delivered, []);
    const frames = vm.frames;
    let iterations = 0;
    vm.frames = new Proxy(frames, {
      get(target, key, receiver) {
        if (key === Symbol.iterator) iterations++;
        return Reflect.get(target, key, receiver);
      }
    });
    try {
      flushCilMethodEvents(vm);
      flushCilMethodEvents(vm);
      assert.equal(iterations, 0, 'No frame-ID collection is needed after the last span closes');
    } finally { vm.frames = frames; }
    assert.deepEqual(delivered.map(event => event.name), ['MethodLoad', 'MethodEnter', 'MethodLeave']);
    assert.equal(delivered.at(-1).payload.reason, 'return');
    exactSpanPayloads(delivered);
  } finally { dispose(); vm.stop(); }
});

test('live spans survive repeated boundaries and restore without exposing reconciliation markers', () => {
  const vm = new CilVirtualMachine(nestedCalls(), {runtimeEvents: true});
  try {
    vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
    assert.deepEqual(vm.frames.map(frame => frame.method.name), ['Main', 'Parent', 'Child']);
    const frames = vm.frames.map(frame => frame.id);
    for (let boundary = 0; boundary < 3; boundary++) {
      vm.runSlice({instructionBudget: 0, timeBudgetMs: 1000});
      assert.deepEqual(leaves(vm), []);
    }
    const snapshot = vm.snapshot();
    assert(snapshot.frames.every(frame => !Object.hasOwn(frame, 'live')));
    vm.restore(snapshot);
    flushCilMethodEvents(vm);
    assert.deepEqual(leaves(vm).map(event => [event.payload.frame, event.payload.reason]),
      [...frames].reverse().map(frame => [frame, 'restore']));
    const sequence = vm.runtimeEvents.sequence;
    assert.throws(() => vm.restore({...snapshot, owner: {}}));
    assert.equal(vm.runtimeEvents.sequence, sequence);
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.deepEqual(leaves(vm).filter(event => event.payload.reason === 'return').map(event => event.payload.frame),
      [...frames].reverse());
    exactSpanPayloads(vm.runtimeEvents.read());
  } finally { vm.stop(); }
});

test('parked spans stay live, then cancellation closes inner-first once even when the first subscriber delivery fails', () => {
  const vm = new CilVirtualMachine(parkedCalls(), {runtimeEvents: true, virtualTime: true});
  const failure = new Error('host subscriber failed');
  const canceled = [];
  let dispose = () => {};
  try {
    assert.equal(vm.run().state, 'waiting', vm.fault?.message);
    const child = [...vm.scheduler.contexts.values()].find(context => context.kind === 'task');
    assert.deepEqual(child.frames.map(frame => frame.method.name), ['Worker', 'Park']);
    const frames = child.frames.map(frame => frame.id);
    vm.runSlice();
    assert.equal(leaves(vm).filter(event => frames.includes(event.payload.frame)).length, 0);
    dispose = vm.runtimeEvents.subscribe(event => {
      if (event.name !== RuntimeEventName.MethodLeave || event.payload.reason !== 'canceled') return;
      canceled.push(event);
      if (canceled.length === 1) throw failure;
    });
    vm.scheduler.cancelAll();
    assert.throws(() => vm.runSlice(), error => error === failure);
    assert.equal(vm.fault, null);
    assert.deepEqual(leaves(vm).filter(event => event.payload.reason === 'canceled').map(event => event.payload.frame),
      [...frames].reverse(), 'Both spans close before deferred subscriber delivery');
    vm.runSlice();
    assert.deepEqual(canceled.map(event => event.payload.frame), [...frames].reverse());
    const sequence = vm.runtimeEvents.sequence;
    vm.stop();
    vm.stop();
    assert.equal(vm.runtimeEvents.sequence, sequence);
    exactSpanPayloads(vm.runtimeEvents.read());
  } finally { dispose(); vm.stop(); }
});

test('a reentrant stop from a subscriber closes spans without entering the current callback snapshot', () => {
  const vm = new CilVirtualMachine(nestedCalls(), {runtimeEvents: true});
  const delivered = [];
  let stopped = false;
  const dispose = vm.runtimeEvents.subscribe(event => {
    delivered.push(event);
    if (!stopped && event.name === RuntimeEventName.MethodEnter && event.payload.method === 0x06000002) {
      stopped = true;
      vm.stop();
    }
  }, {replay: true});
  try {
    vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
    assert.equal(stopped, true);
    assert.equal(vm.state, 'terminated');
    assert.equal(vm.frames.length, 0);
    assert.equal(delivered.filter(event => event.name === RuntimeEventName.MethodLeave).length, 0);
    assert.deepEqual(leaves(vm).map(event => [event.payload.method, event.payload.reason]),
      [[0x06000003, 'stop'], [0x06000002, 'stop'], [0x06000001, 'stop']]);
    vm.runSlice();
    assert.deepEqual(delivered.filter(event => event.name === RuntimeEventName.MethodLeave), leaves(vm));
    exactSpanPayloads(delivered);
    const count = delivered.length;
    vm.runSlice();
    assert.equal(delivered.length, count);
  } finally { dispose(); vm.stop(); }
});

test('retained fatal inspection frames stay open until stop, with unchanged stop payloads', () => {
  const vm = new CilVirtualMachine(nestedCalls(), {runtimeEvents: true});
  try {
    // Apply the host instruction limit after metadata admission.
    vm.options.maxInstructions = 1;
    assert.equal(vm.run().state, 'faulted');
    assert.equal(vm.fault.name, 'InstructionLimitException');
    const frames = vm.frames.map(frame => frame.id);
    assert(frames.length > 0);
    assert.deepEqual(leaves(vm), []);
    flushCilMethodEvents(vm);
    assert.deepEqual(leaves(vm), []);
    vm.stop();
    assert.deepEqual(leaves(vm).map(event => [event.payload.frame, event.payload.reason]),
      [...frames].reverse().map(frame => [frame, 'stop']));
    exactSpanPayloads(vm.runtimeEvents.read());
  } finally { vm.stop(); }
});
