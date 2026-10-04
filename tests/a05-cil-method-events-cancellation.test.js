import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, RuntimeEventName} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

function scheduledWorker() {
  return managedFixture({fields: [{name: 'Progress', type: 'int'}], methods: [
    {name: 'Main', body(writer, context) {
      writer.op('ldnull').op('ldftn', context.methods.Worker)
        .op('newobj', context.member('System.Action', '.ctor', 'void', ['object', 'nint'], false))
        .op('call', context.member('System.Threading.Tasks.Task', 'Run', 'System.Threading.Tasks.Task', ['System.Action']))
        .op('pop').op('ret');
    }},
    {name: 'Worker', body: (writer, context) => writer.op('call', context.methods.Park)
      .op('ldc.i4.1').op('stsfld', context.fields.Progress).op('ret')},
    {name: 'Park', body: (writer, context) => writer.op('ldc.i4', 60000)
      .op('call', context.member('System.Threading.Thread', 'Sleep', 'void', ['int'])).op('ret')}
  ]});
}

function parkChild(vm) {
  assert.equal(vm.run().state, 'waiting', vm.fault?.message);
  assert.equal(vm.scheduler.parked, true);
  assert.deepEqual(vm.frames, []);
  const child = [...vm.scheduler.contexts.values()].find(context => context.kind === 'task');
  assert(child);
  assert.equal(child.status, 'waiting');
  assert.deepEqual(child.frames.map(frame => frame.method.name), ['Worker', 'Park']);
  assert(child.wait?.task);
  assert.equal(vm.statics.get(0x04000001), 0);
  return child;
}

function assertBalanced(events) {
  const entries = events.filter(event => event.name === RuntimeEventName.MethodEnter);
  const leaves = events.filter(event => event.name === RuntimeEventName.MethodLeave);
  assert.equal(entries.length, 3);
  assert.equal(leaves.length, entries.length);
  for (const entry of entries) {
    const matching = leaves.filter(leave => leave.payload.frame === entry.payload.frame);
    assert.equal(matching.length, 1, 'Each admitted frame must leave exactly once');
    assert.equal(matching[0].payload.method, entry.payload.method);
    assert(matching[0].sequence > entry.sequence);
  }
}

test('T10.2 canceling a real parked delegate closes nested frames once, innermost first', () => {
  const vm = new CilVirtualMachine(scheduledWorker(), {runtimeEvents: true, virtualTime: true});
  const delivered = [], unsubscribe = vm.runtimeEvents.subscribe(event => delivered.push(event), {replay: true});
  try {
    const child = parkChild(vm), frames = child.frames.map(frame => frame.id);
    const childLeaves = () => delivered.filter(event => event.name === RuntimeEventName.MethodLeave &&
      frames.includes(event.payload.frame));
    assert.deepEqual(childLeaves(), []);
    vm.runSlice();
    assert.deepEqual(childLeaves(), [], 'A live parked stack must not be reported as canceled');

    vm.scheduler.cancelAll();
    assert.equal(child.status, 'canceled');
    assert.deepEqual(child.frames, []);
    assert.equal(child.wait, null);
    assert([...vm.scheduler.tasks.values()].every(task => task.status === 'canceled'));
    assert.deepEqual(childLeaves(), [], 'Cancellation enqueues no host callbacks inside the scheduler');
    vm.runSlice();
    assert.deepEqual(childLeaves().map(event => [event.payload.frame, event.payload.reason]),
      [[frames[1], 'canceled'], [frames[0], 'canceled']]);
    assertBalanced(delivered);

    const sequence = vm.runtimeEvents.sequence;
    vm.scheduler.cancelAll();
    vm.scheduler.advance(60000);
    vm.runSlice();
    assert.equal(vm.statics.get(0x04000001), 0, 'The canceled delegate continuation must not run');
    assert.equal(vm.runtimeEvents.sequence, sequence);
    vm.stop();
    assert.equal(vm.runtimeEvents.sequence, sequence, 'Stop must not close canceled frames a second time');
    assertBalanced(delivered);
    assert.equal(vm.fault, null);
  } finally { unsubscribe(); vm.stop(); }
});

test('T10.2 a parked delegate that wakes naturally emits returns rather than canceled leaves', () => {
  const vm = new CilVirtualMachine(scheduledWorker(), {runtimeEvents: true, virtualTime: true});
  try {
    const child = parkChild(vm), frames = child.frames.map(frame => frame.id);
    vm.scheduler.advance(60000);
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.equal(vm.statics.get(0x04000001), 1);
    assert.equal(child.status, 'completed');
    assert.deepEqual(child.frames, []);
    const events = vm.runtimeEvents.read();
    assertBalanced(events);
    const leaves = events.filter(event => event.name === RuntimeEventName.MethodLeave && frames.includes(event.payload.frame));
    assert.deepEqual(leaves.map(event => [event.payload.frame, event.payload.reason]),
      [[frames[1], 'return'], [frames[0], 'return']]);
    const sequence = vm.runtimeEvents.sequence;
    vm.stop();
    assert.equal(vm.runtimeEvents.sequence, sequence);
  } finally { vm.stop(); }
});
