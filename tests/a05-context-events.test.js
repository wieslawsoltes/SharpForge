import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, RuntimeEventName} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const transitions = vm => vm.runtimeEvents.read().filter(event =>
  event.name === RuntimeEventName.Suspend || event.name === RuntimeEventName.Resume);
const plainFixture = () => managedFixture({methods: [{name: 'Main', result: 'int',
  body: writer => writer.op('nop').op('nop').op('ldc.i4.7').op('ret')}]});
const sleepFixture = () => managedFixture({methods: [{name: 'Main', result: 'int', body: (writer, context) => writer
  .op('ldc.i4', 10).op('call', context.member('System.Threading.Thread', 'Sleep', 'void', ['int']))
  .op('ldc.i4.7').op('ret')}]});

function workerFixture() {
  return managedFixture({fields: [{name: 'Progress', type: 'int'}], methods: [
    {name: 'Main', body: (writer, context) => writer.op('ldnull').op('ldftn', context.methods.Worker)
      .op('newobj', context.member('System.Action', '.ctor', 'void', ['object', 'nint'], false))
      .op('call', context.member('System.Threading.Tasks.Task', 'Run', 'System.Threading.Tasks.Task', ['System.Action']))
      .op('pop').op('nop').op('nop').op('ret')},
    {name: 'Worker', body: (writer, context) => writer.op('ldc.i4', 10)
      .op('call', context.member('System.Threading.Thread', 'Sleep', 'void', ['int']))
      .op('ldc.i4.1').op('stsfld', context.fields.Progress).op('ret')}
  ]});
}

test('real wait and wake emit deferred context/frame pairs after committing scheduler state', () => {
  const vm = new CilVirtualMachine(sleepFixture(), {runtimeEvents: true, virtualTime: true});
  const delivered = [], unsubscribe = vm.runtimeEvents.subscribe(event => delivered.push(event));
  const frame = vm.top.id;
  try {
    assert.equal(vm.run().state, 'waiting');
    assert.equal(vm.scheduler.parked, true);
    assert.deepEqual(vm.frames, []);
    assert.deepEqual(transitions(vm).map(event => [event.name, event.payload]), [['Suspend', {context: 1, frame}]]);
    assert.equal(transitions(vm)[0].instruction, 2);
    vm.runSlice();
    assert.equal(transitions(vm).length, 1, 'an already parked slice is not a new suspension');
    const deliveredBeforeWake = delivered.length;
    vm.scheduler.advance(10);
    assert.equal(vm.scheduler.parked, false);
    assert.equal(vm.state, 'running');
    assert.equal(vm.top.id, frame);
    assert.equal(delivered.length, deliveredBeforeWake, 'scheduler activation invokes no subscribers');
    assert.deepEqual(transitions(vm).map(event => event.name), ['Suspend', 'Resume']);
    assert.deepEqual(transitions(vm)[1].payload, {context: 1, frame});
    assert.equal(vm.run().returnValue, 7);
    assert.deepEqual(delivered.filter(event => ['Suspend', 'Resume'].includes(event.name)).map(event => event.name),
      ['Suspend', 'Resume']);
  } finally { unsubscribe(); vm.stop(); }
});

test('ordinary slice yields and self-selected scheduling quanta do not invent transitions', () => {
  const vm = new CilVirtualMachine(plainFixture(), {runtimeEvents: true, virtualTime: true, schedulerQuantum: 1});
  vm.scheduler.ensure();
  try {
    while (vm.state === 'ready' || vm.state === 'running') {
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    }
    assert.equal(vm.returnValue, 7);
    assert.deepEqual(transitions(vm), []);
  } finally { vm.stop(); }
});

test('a newly queued child has no invented resume before its first real suspension', () => {
  const vm = new CilVirtualMachine(workerFixture(), {runtimeEvents: true, virtualTime: true});
  try {
    assert.equal(vm.run().state, 'waiting');
    const child = [...vm.scheduler.contexts.values()].find(context => context.kind === 'task');
    assert.equal(child.status, 'waiting');
    assert.deepEqual(transitions(vm).map(event => [event.name, event.payload.context]), [['Suspend', child.id]]);
    vm.scheduler.advance(10);
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.statics.get(0x04000001), 1);
    assert.deepEqual(transitions(vm).map(event => [event.name, event.payload.context]),
      [['Suspend', child.id], ['Resume', child.id]]);
  } finally { vm.stop(); }
});

test('actual round-robin switches form ordered per-context pairs without changing the result', () => {
  const vm = new CilVirtualMachine(workerFixture(), {runtimeEvents: true, virtualTime: true, schedulerQuantum: 1});
  const plain = new CilVirtualMachine(workerFixture(), {virtualTime: true, schedulerQuantum: 1});
  try {
    for (const machine of [plain, vm]) {
      assert.equal(machine.run().state, 'waiting');
      machine.scheduler.advance(10);
      assert.equal(machine.run().state, 'terminated');
    }
    assert.equal(vm.statics.get(0x04000001), plain.statics.get(0x04000001));
    assert.equal(vm.instructions, plain.instructions);
    const parked = new Set();
    for (const event of transitions(vm)) {
      assert(Object.isFrozen(event.payload));
      assert.deepEqual(Object.keys(event.payload), ['context', 'frame']);
      if (event.name === 'Suspend') {
        assert.equal(parked.has(event.payload.context), false);
        parked.add(event.payload.context);
      } else {
        assert.equal(parked.delete(event.payload.context), true);
      }
    }
    assert(transitions(vm).some(event => event.name === 'Resume' && event.payload.context === 1));
  } finally { vm.stop(); plain.stop(); }
});

test('freezing the active context parks once and unfreezing resumes its live invocation', () => {
  const vm = new CilVirtualMachine(plainFixture(), {runtimeEvents: true, virtualTime: true});
  const frame = vm.top.id;
  try {
    vm.scheduler.freeze(1);
    vm.runSlice();
    vm.runSlice();
    assert.equal(vm.instructions, 0);
    assert.deepEqual(transitions(vm).map(event => event.name), ['Suspend']);
    vm.scheduler.freeze(1, false);
    vm.runSlice();
    assert.equal(vm.returnValue, 7);
    assert.deepEqual(transitions(vm).map(event => [event.name, event.payload.frame]), [['Suspend', frame], ['Resume', frame]]);
  } finally { vm.stop(); }
});

test('restore starts a fresh observation baseline without replaying suspension history', () => {
  const vm = new CilVirtualMachine(sleepFixture(), {runtimeEvents: true, virtualTime: true});
  const schedulerKeys = Object.keys(vm.scheduler);
  try {
    assert.equal(vm.run().state, 'waiting');
    const snapshot = vm.snapshot();
    const contextKeys = Object.keys(snapshot.scheduler.contexts.find(([id]) => id === vm.scheduler.currentId)[1]);
    vm.scheduler.advance(10);
    assert.equal(vm.run().returnValue, 7);
    assert.equal(transitions(vm).length, 2);
    vm.restore(snapshot);
    assert.deepEqual(Object.keys(vm.scheduler), schedulerKeys);
    assert.deepEqual(Object.keys(vm.scheduler.current), contextKeys);
    vm.scheduler.advance(10);
    assert.equal(vm.run().returnValue, 7);
    assert.equal(transitions(vm).length, 2, 'first activation after restore establishes a new baseline');
  } finally { vm.stop(); }
});

test('cancellation ends an observed suspension without a fabricated resume', () => {
  const vm = new CilVirtualMachine(sleepFixture(), {runtimeEvents: true, virtualTime: true});
  try {
    assert.equal(vm.run().state, 'waiting');
    const count = transitions(vm).length;
    vm.scheduler.cancelAll();
    vm.scheduler.advance(10);
    vm.runSlice();
    vm.stop();
    vm.stop();
    assert.equal(transitions(vm).length, count);
    assert.equal(vm.scheduler.current.status, 'canceled');
  } finally { vm.stop(); }
});

test('subscriber failures are host errors after parking, and small logs keep bounded drop semantics', () => {
  const vm = new CilVirtualMachine(sleepFixture(), {runtimeEvents: {capacity: 1}, virtualTime: true});
  const failure = new Error('scheduler observer');
  const unsubscribe = vm.runtimeEvents.subscribe(event => {
    if (event.name === RuntimeEventName.Suspend) throw failure;
  });
  try {
    assert.throws(() => vm.run(), error => error === failure);
    assert.equal(vm.state, 'waiting');
    assert.equal(vm.scheduler.current.status, 'waiting');
    assert.equal(vm.fault, null);
    assert.equal(vm.runtimeEvents.read().length, 1);
    assert(vm.runtimeEvents.dropped >= 2);
    unsubscribe();
    vm.scheduler.advance(10);
    assert.equal(vm.run().returnValue, 7);
  } finally { unsubscribe(); vm.stop(); }
});
