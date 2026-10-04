import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, RuntimeEventName} from '@sharpforge/runtime';
import {flushSourceRuntimeEvents} from '../packages/runtime/src/execution/source-runtime-events.js';

const nested = `class Program {
  static void Child() { Console.Write("child"); }
  static void Parent() { Child(); }
  static void Main() { Parent(); }
}`;
const parked = `using System.Threading; using System.Threading.Tasks;
class Program {
  static void Park() { Thread.Sleep(60000); }
  static void Worker() { Park(); }
  static void Main() { Task.Run(Worker); }
}`;
const compiled = new Map();

function make(engine, source = nested, options = {}) {
  let artifact = compiled.get(source);
  if (!artifact) {
    artifact = compileToIL(source);
    assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
    compiled.set(source, artifact);
  }
  return new VirtualMachine(engine === 'source' ? artifact.image : artifact.assembly, {runtimeEvents: true, ...options});
}

const leaves = vm => vm.runtimeEvents.read().filter(event => event.name === RuntimeEventName.MethodLeave);

function pauseIn(vm, name) {
  for (let count = 0; count < 500; count++) {
    if (vm.top && vm.image.methods[vm.top.methodId].name === name) return;
    assert(['ready', 'running'].includes(vm.state));
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
  }
  assert.fail('Did not reach ' + name);
}

function exactSpanPayloads(events) {
  for (const event of events) {
    if (![RuntimeEventName.MethodEnter, RuntimeEventName.MethodLeave].includes(event.name)) continue;
    assert.deepEqual(Object.keys(event.payload), ['method', 'frame', 'reason']);
    assert(Object.isFrozen(event.payload));
  }
}

for (const engine of ['source', 'reload']) {
  test(`${engine}: no active spans skips frame enumeration without skipping deferred replay`, () => {
    const vm = make(engine), delivered = [];
    let dispose = () => {};
    try {
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      assert.equal(vm.frames.length, 0);
      dispose = vm.runtimeEvents.subscribe(event => delivered.push(event), {replay: true});
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
        flushSourceRuntimeEvents(vm);
        flushSourceRuntimeEvents(vm);
        assert.equal(iterations, 0);
      } finally { vm.frames = frames; }
      assert.deepEqual(delivered, vm.runtimeEvents.read());
      assert(delivered.some(event => event.name === RuntimeEventName.MethodLeave));
      exactSpanPayloads(delivered);
    } finally { dispose(); vm.stop(); }
  });

  test(`${engine}: repeated live boundaries and restore preserve spans and metadata load identity`, () => {
    const vm = make(engine);
    try {
      pauseIn(vm, 'Child');
      const frames = vm.frames.map(frame => ({method: frame.methodId, frame: frame.id}));
      const initial = vm.runtimeEvents.export();
      for (let boundary = 0; boundary < 3; boundary++) {
        vm.runSlice({instructionBudget: 0, timeBudgetMs: 1000});
        assert.equal(vm.runtimeEvents.sequence, initial.sequence);
      }
      const snapshot = vm.snapshot();
      assert(snapshot.frames.every(frame => !Object.hasOwn(frame, 'live')));
      vm.restore(snapshot);
      const changed = vm.runtimeEvents.read({after: initial.sequence});
      assert.deepEqual(changed.map(event => [event.name, event.payload]), [
        ...frames.toReversed().map(frame => ['MethodLeave', {...frame, reason: 'restore'}]),
        ...frames.map(frame => ['MethodEnter', {...frame, reason: 'restore'}])
      ]);
      flushSourceRuntimeEvents(vm);
      const sequence = vm.runtimeEvents.sequence;
      assert.throws(() => vm.restore({...snapshot, owner: {}}), /another source VM/);
      assert.equal(vm.runtimeEvents.sequence, sequence);
      assert.equal(vm.run().output, 'child');
      assert.deepEqual(leaves(vm).filter(event => event.payload.reason === 'return' &&
        frames.some(frame => frame.frame === event.payload.frame)).map(event => event.payload.frame),
      frames.toReversed().map(frame => frame.frame));
      exactSpanPayloads(vm.runtimeEvents.read());
    } finally { vm.stop(); }
  });

  test(`${engine}: cancellation closes parked spans inner-first before a failing callback, without retry duplicates`, () => {
    const vm = make(engine, parked, {virtualTime: true}), canceled = [];
    const failure = new Error('source event subscriber');
    let dispose = () => {};
    try {
      assert.equal(vm.run().state, 'waiting', vm.fault?.message);
      const child = [...vm.scheduler.contexts.values()].find(context => context.kind === 'task');
      assert(child);
      assert.deepEqual(child.frames.map(frame => vm.image.methods[frame.methodId].name), ['Worker', 'Park']);
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
        frames.toReversed());
      vm.runSlice();
      assert.deepEqual(canceled.map(event => event.payload.frame), frames.toReversed());
      const sequence = vm.runtimeEvents.sequence;
      vm.stop();
      vm.stop();
      assert.equal(vm.runtimeEvents.sequence, sequence);
      exactSpanPayloads(vm.runtimeEvents.read());
    } finally { dispose(); vm.stop(); }
  });

  test(`${engine}: reentrant stop closes all live spans but defers new leaves to the next callback snapshot`, () => {
    const vm = make(engine), delivered = [];
    let dispose = () => {}, stopped = false;
    try {
      pauseIn(vm, 'Child');
      const frames = vm.frames.map(frame => frame.id);
      dispose = vm.runtimeEvents.subscribe(event => {
        delivered.push(event);
        if (!stopped && event.name === RuntimeEventName.MethodEnter &&
            vm.image.methods[event.payload.method].name === 'Parent') {
          stopped = true;
          vm.stop();
        }
      }, {replay: true});
      flushSourceRuntimeEvents(vm);
      assert.equal(stopped, true);
      assert.equal(vm.state, 'terminated');
      assert.equal(vm.frames.length, 0);
      assert.equal(delivered.filter(event => event.name === RuntimeEventName.MethodLeave &&
        frames.includes(event.payload.frame)).length, 0);
      assert.deepEqual(leaves(vm).filter(event => event.payload.reason === 'stop').map(event => event.payload.frame),
        frames.toReversed());
      vm.runSlice();
      assert.deepEqual(delivered.filter(event => event.name === RuntimeEventName.MethodLeave), leaves(vm));
      exactSpanPayloads(delivered);
      const count = delivered.length;
      vm.runSlice();
      assert.equal(delivered.length, count);
    } finally { dispose(); vm.stop(); }
  });

  test(`${engine}: fatal inspection keeps live spans open until explicit stop`, () => {
    const vm = make(engine);
    try {
      pauseIn(vm, 'Child');
      const frames = vm.frames.map(frame => frame.id);
      vm.options.maxInstructions = vm.instructions;
      assert.equal(vm.run().state, 'faulted');
      assert.equal(vm.fault.name, 'InstructionLimitException');
      assert.deepEqual(vm.frames.map(frame => frame.id), frames);
      flushSourceRuntimeEvents(vm);
      assert.equal(leaves(vm).filter(event => frames.includes(event.payload.frame)).length, 0);
      vm.stop();
      assert.deepEqual(leaves(vm).filter(event => event.payload.reason === 'stop').map(event => event.payload.frame),
        frames.toReversed());
      exactSpanPayloads(vm.runtimeEvents.read());
    } finally { vm.stop(); }
  });
}
