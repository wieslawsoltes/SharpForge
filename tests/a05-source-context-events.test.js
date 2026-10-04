import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, RuntimeEventName} from '@sharpforge/runtime';

const sleep = `using System.Threading; class Program {
  static void Main() { Thread.Sleep(10); Console.Write("awake"); }
}`;
const worker = `using System.Threading; using System.Threading.Tasks;
class Program {
  static void Worker() { Thread.Sleep(10); Console.Write("worker"); }
  static void Main() { Task.Run(Worker); Console.Write("main"); }
}`;
const plain = 'class Program { static void Main() { int value = 40; Console.WriteLine(value + 2); } }';
const cache = new Map();
function make(engine, source = sleep, options = {}) {
  let artifact = cache.get(source);
  if (!artifact) {
    artifact = compileToIL(source);
    assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
    cache.set(source, artifact);
  }
  return new VirtualMachine(engine === 'source' ? artifact.image : artifact.assembly,
    {runtimeEvents: true, virtualTime: true, ...options});
}
const transitions = vm => vm.runtimeEvents.read().filter(event =>
  event.name === RuntimeEventName.Suspend || event.name === RuntimeEventName.Resume);

for (const engine of ['source', 'reload']) {
  test(`${engine}: real wait and wake report committed context/frame transitions without immediate subscribers`, () => {
    const vm = make(engine), delivered = [];
    const unsubscribe = vm.runtimeEvents.subscribe(event => {
      if (event.name === 'Suspend' || event.name === 'Resume') delivered.push(event);
    });
    try {
      assert.equal(vm.run().state, 'waiting', vm.fault?.message);
      assert.equal(vm.scheduler.parked, true);
      assert.deepEqual(vm.frames, []);
      const context = vm.scheduler.current, frame = context.frames.at(-1).id;
      assert.deepEqual(transitions(vm).map(event => [event.name, event.payload]),
        [['Suspend', {context: context.id, frame}]]);
      assert.equal(transitions(vm)[0].instruction, vm.instructions);
      vm.runSlice();
      assert.equal(transitions(vm).length, 1);
      const deliveredBeforeWake = delivered.length;
      vm.scheduler.advance(10);
      assert.equal(vm.state, 'running');
      assert.equal(vm.top.id, frame);
      assert.equal(delivered.length, deliveredBeforeWake);
      assert.deepEqual(transitions(vm).map(event => [event.name, event.payload]), [
        ['Suspend', {context: context.id, frame}], ['Resume', {context: context.id, frame}]
      ]);
      assert.equal(vm.run().output, 'awake');
      assert.deepEqual(delivered, transitions(vm));
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: ordinary budget yields and self-selected quanta produce no context events`, () => {
    const vm = make(engine, plain, {schedulerQuantum: 1});
    vm.scheduler.ensure();
    try {
      for (let step = 0; step < 500 && ['ready', 'running'].includes(vm.state); step++) {
        vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
      }
      assert.equal(vm.state, 'terminated', vm.fault?.message);
      assert.equal(vm.output.join(''), '42\n');
      assert.deepEqual(transitions(vm), []);
    } finally { vm.stop(); }
  });

  test(`${engine}: first queued child activation is silent until its actual suspension`, () => {
    const vm = make(engine, worker);
    try {
      assert.equal(vm.run().state, 'waiting', vm.fault?.message);
      const child = [...vm.scheduler.contexts.values()].find(context => context.kind === 'task');
      assert.equal(child.status, 'waiting');
      const childEvents = () => transitions(vm).filter(event => event.payload.context === child.id);
      assert.deepEqual(childEvents().map(event => event.name), ['Suspend']);
      vm.scheduler.advance(10);
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      assert.equal(vm.output.join(''), 'mainworker');
      assert.deepEqual(childEvents().map(event => event.name), ['Suspend', 'Resume']);
    } finally { vm.stop(); }
  });

  test(`${engine}: real round-robin switches preserve output and instruction accounting`, () => {
    const vm = make(engine, worker, {schedulerQuantum: 1});
    const unobserved = make(engine, worker, {schedulerQuantum: 1, runtimeEvents: false});
    try {
      for (const current of [unobserved, vm]) {
        assert.equal(current.run().state, 'waiting', current.fault?.message);
        current.scheduler.advance(10);
        assert.equal(current.run().state, 'terminated', current.fault?.message);
      }
      assert.equal(vm.output.join(''), unobserved.output.join(''));
      assert.equal(vm.instructions, unobserved.instructions);
      assert.equal(unobserved.runtimeEvents, null);
      const suspended = new Set();
      for (const event of transitions(vm)) {
        assert.equal(Object.isFrozen(event.payload), true);
        assert.deepEqual(Object.keys(event.payload), ['context', 'frame']);
        assert(Number.isSafeInteger(event.payload.context));
        assert(Number.isSafeInteger(event.payload.frame));
        if (event.name === 'Suspend') {
          assert.equal(suspended.has(event.payload.context), false);
          suspended.add(event.payload.context);
        } else assert.equal(suspended.delete(event.payload.context), true);
      }
      assert(transitions(vm).some(event => event.name === 'Resume' && event.payload.context === 1));
    } finally { vm.stop(); unobserved.stop(); }
  });

  test(`${engine}: freeze parks the live invocation once and unfreeze resumes it`, () => {
    const vm = make(engine, plain), frame = vm.top.id;
    try {
      vm.scheduler.freeze(1);
      vm.runSlice();
      vm.runSlice();
      assert.equal(vm.instructions, 0);
      assert.deepEqual(transitions(vm).map(event => [event.name, event.payload.frame]), [['Suspend', frame]]);
      vm.scheduler.freeze(1, false);
      vm.runSlice();
      assert.equal(vm.output.join(''), '42\n');
      assert.deepEqual(transitions(vm).map(event => [event.name, event.payload.frame]), [['Suspend', frame], ['Resume', frame]]);
    } finally { vm.stop(); }
  });

  test(`${engine}: restore resets only the observation baseline while retaining host history and schema`, () => {
    const vm = make(engine), schedulerKeys = Object.keys(vm.scheduler);
    try {
      assert.equal(vm.run().state, 'waiting');
      const snapshot = vm.snapshot();
      const contextKeys = Object.keys(snapshot.scheduler.contexts.find(([id]) => id === vm.scheduler.currentId)[1]);
      vm.scheduler.advance(10);
      assert.equal(vm.run().output, 'awake');
      const history = transitions(vm);
      assert.equal(history.length, 2);
      vm.restore(snapshot);
      assert.deepEqual(Object.keys(vm.scheduler), schedulerKeys);
      assert.deepEqual(Object.keys(vm.scheduler.current), contextKeys);
      assert.deepEqual(transitions(vm), history);
      // Source restores pause; resume a parked snapshot through its existing waiting state.
      vm.state = 'waiting';
      vm.scheduler.advance(10);
      assert.equal(vm.run().output, 'awake');
      assert.deepEqual(transitions(vm), history, 'Restored first activation has no fabricated Resume');
    } finally { vm.stop(); }
  });

  test(`${engine}: canceled suspensions do not fabricate a resume during wake or repeated stop`, () => {
    const vm = make(engine);
    try {
      assert.equal(vm.run().state, 'waiting');
      const history = transitions(vm);
      assert.equal(history.length, 1);
      vm.scheduler.cancelAll();
      vm.scheduler.advance(10);
      vm.runSlice();
      vm.stop();
      vm.stop();
      assert.equal(vm.scheduler.current.status, 'canceled');
      assert.deepEqual(transitions(vm), history);
      assert.equal(vm.output.join(''), '');
    } finally { vm.stop(); }
  });

  test(`${engine}: subscriber failure occurs after parking and remains a host error in a bounded log`, () => {
    const vm = make(engine, sleep, {runtimeEvents: {capacity: 1}}), failure = new Error('context observer');
    const unsubscribe = vm.runtimeEvents.subscribe(event => {
      if (event.name === 'Suspend') throw failure;
    });
    try {
      assert.throws(() => vm.run(), error => error === failure);
      assert.equal(vm.state, 'waiting');
      assert.equal(vm.scheduler.current.status, 'waiting');
      assert.equal(vm.fault, null);
      assert.equal(vm.runtimeEvents.read().length, 1);
      assert.equal(vm.runtimeEvents.read()[0].name, 'Suspend');
      assert(vm.runtimeEvents.dropped > 0);
      unsubscribe();
      vm.scheduler.advance(10);
      assert.equal(vm.run().output, 'awake');
    } finally { unsubscribe(); vm.stop(); }
  });
}
