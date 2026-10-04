import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, instructionProfile, RuntimeEventName} from '@sharpforge/runtime';

const sleep = `using System.Threading; class Program {
  static void Main() { Thread.Sleep(10); Console.Write("awake"); }
}`;
const worker = `using System.Threading; using System.Threading.Tasks; class Program {
  static void Worker() { Thread.Sleep(10); Console.Write("worker"); }
  static void Main() { Task.Run(Worker); Console.Write("main"); }
}`;
const plain = 'class Program { static void Main() { int value = 40; Console.WriteLine(value + 2); } }';
const artifacts = new Map();

function make(engine, source = sleep, options = {}) {
  let artifact = artifacts.get(source);
  if (!artifact) {
    artifact = compileToIL(source);
    assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
    artifacts.set(source, artifact);
  }
  const configuration = {profile: true, runtimeEvents: false, virtualTime: true, ...options};
  return engine === 'cil' ? new CilVirtualMachine(artifact.assembly, configuration)
    : new VirtualMachine(engine === 'source' ? artifact.image : artifact.assembly, configuration);
}

const count = vm => instructionProfile(vm).suspensions;

for (const engine of ['source', 'reload', 'cil']) {
  test(`${engine}: real suspension counts once with runtime events disabled and waking does not add a count`, () => {
    const vm = make(engine);
    try {
      assert.equal(vm.runtimeEvents ?? null, null);
      assert.equal(count(vm), 0);
      assert.equal(vm.run().state, 'waiting', vm.fault?.message);
      assert.equal(vm.scheduler.parked, true);
      assert.equal(count(vm), 1);
      vm.runSlice();
      vm.runSlice();
      assert.equal(count(vm), 1);
      vm.scheduler.advance(10);
      assert.equal(count(vm), 1);
      assert.equal(vm.run().output, 'awake');
      const view = instructionProfile(vm);
      view.suspensions = -1;
      assert.equal(count(vm), 1, 'Counter views do not expose mutable profiler storage');
      assert.equal(Object.hasOwn(vm, 'suspensions'), false);
      assert.equal(Object.hasOwn(vm.scheduler, 'suspensions'), false);
      assert.equal(Object.hasOwn(vm.scheduler.current, 'suspensions'), false);
    } finally { vm.stop(); }
  });

  test(`${engine}: ordinary slices, debugger pauses and self-selected quanta are not suspensions`, () => {
    const vm = make(engine, plain, {schedulerQuantum: 1});
    vm.scheduler.ensure();
    try {
      vm.runSlice({timeBudgetMs: 1000, ...(engine === 'cil' ? {onInstruction: () => true} : {onSequence: () => true})});
      assert.equal(vm.state, 'paused');
      assert.equal(count(vm), 0);
      vm.state = 'running';
      for (let step = 0; step < 500 && ['ready', 'running'].includes(vm.state); step++) {
        vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
        assert.equal(count(vm), 0);
      }
      assert.equal(vm.state, 'terminated', vm.fault?.message);
      assert.equal(vm.output.join(''), '42\n');
    } finally { vm.stop(); }
  });

  test(`${engine}: a new child activation counts only its later suspension`, () => {
    const vm = make(engine, worker);
    try {
      assert.equal(vm.run().state, 'waiting', vm.fault?.message);
      const child = [...vm.scheduler.contexts.values()].find(context => context.kind === 'task');
      assert.equal(child.status, 'waiting');
      assert.equal(count(vm), 1);
      vm.scheduler.advance(10);
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      assert.equal(vm.output.join(''), 'mainworker');
      assert.equal(count(vm), 1);
    } finally { vm.stop(); }
  });

  test(`${engine}: real context switches contribute without changing program output or instructions`, () => {
    const observed = make(engine, worker, {schedulerQuantum: 1});
    const disabled = make(engine, worker, {schedulerQuantum: 1, profile: false});
    try {
      for (const vm of [disabled, observed]) {
        assert.equal(vm.run().state, 'waiting', vm.fault?.message);
        vm.scheduler.advance(10);
        assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      }
      assert(count(observed) > 1, 'Round-robin switches add suspensions beyond the one timed wait');
      assert.equal(observed.output.join(''), disabled.output.join(''));
      assert.equal(observed.instructions, disabled.instructions);
      assert.equal(instructionProfile(disabled), null);
      assert.equal(disabled.profiler, null);
    } finally { observed.stop(); disabled.stop(); }
  });

  test(`${engine}: restore preserves cumulative counts and does not replay a parked snapshot suspension`, () => {
    const vm = make(engine);
    try {
      const initial = vm.snapshot();
      const profiler = vm.profiler;
      assert.equal(vm.run().state, 'waiting');
      const waiting = vm.snapshot();
      assert.equal(Object.hasOwn(waiting, 'profiler'), false);
      assert.equal(Object.hasOwn(waiting, 'suspensions'), false);
      assert.equal(Object.hasOwn(waiting.scheduler, 'suspensions'), false);
      assert.equal(count(vm), 1);
      vm.scheduler.advance(10);
      assert.equal(vm.run().output, 'awake');
      vm.restore(initial);
      assert.equal(vm.profiler, profiler);
      assert.equal(count(vm), 1);
      assert.equal(vm.run().state, 'waiting');
      assert.equal(count(vm), 2);
      vm.restore(waiting);
      assert.equal(count(vm), 2);
      // Source restore pauses; resume an already parked snapshot through the existing waiting state.
      if (engine !== 'cil') vm.state = 'waiting';
      vm.scheduler.advance(10);
      assert.equal(vm.run().output, 'awake');
      assert.equal(count(vm), 2);
      assert.throws(() => vm.restore({...waiting, owner: {}}));
      assert.equal(count(vm), 2);
      vm.stop();
      vm.stop();
      assert.equal(count(vm), 2);
    } finally { vm.stop(); }
  });

  test(`${engine}: freezing parks once while cancellation and repeated stop do not invent counts`, () => {
    const vm = make(engine, plain);
    try {
      vm.scheduler.freeze(1);
      vm.runSlice();
      vm.runSlice();
      assert.equal(vm.instructions, 0);
      assert.equal(count(vm), 1);
      vm.scheduler.freeze(1, false);
      vm.runSlice();
      assert.equal(vm.run().output, '42\n');
      assert.equal(count(vm), 1);
    } finally { vm.stop(); }
    const canceled = make(engine);
    try {
      assert.equal(canceled.run().state, 'waiting');
      assert.equal(count(canceled), 1);
      canceled.scheduler.cancelAll();
      canceled.scheduler.advance(10);
      canceled.runSlice();
      canceled.stop();
      canceled.stop();
      assert.equal(count(canceled), 1);
      assert.equal(canceled.output.join(''), '');
    } finally { canceled.stop(); }
  });

  test(`${engine}: profiling off leaves the observer absent through waiting and snapshot replay`, () => {
    const vm = make(engine, sleep, {profile: false});
    try {
      assert.equal(vm.run().state, 'waiting');
      const snapshot = vm.snapshot();
      assert.equal(instructionProfile(vm), null);
      assert.equal(vm.profiler, null);
      vm.restore(snapshot);
      if (engine !== 'cil') vm.state = 'waiting';
      vm.scheduler.advance(10);
      assert.equal(vm.run().output, 'awake');
      assert.equal(instructionProfile(vm), null);
      assert.equal(vm.profiler, null);
    } finally { vm.stop(); }
  });
}

test('CIL: independent event and profiler observers agree on actual switches before ring eviction', () => {
  const vm = make('cil', worker, {runtimeEvents: true, schedulerQuantum: 1});
  try {
    assert.equal(vm.run().state, 'waiting');
    vm.scheduler.advance(10);
    assert.equal(vm.run().state, 'terminated');
    const suspensions = vm.runtimeEvents.read().filter(event => event.name === RuntimeEventName.Suspend);
    assert.equal(count(vm), suspensions.length);
    assert(suspensions.length > 1);
  } finally { vm.stop(); }
});

test('CIL: cumulative suspension counts survive event loss and host subscriber errors', () => {
  const twice = 'using System.Threading; class Program { static void Main() { Thread.Sleep(10); Thread.Sleep(10); } }';
  const vm = make('cil', twice, {runtimeEvents: {capacity: 1}});
  const failure = new Error('subscriber failed');
  const dispose = vm.runtimeEvents.subscribe(event => {
    if (event.name === RuntimeEventName.Suspend) throw failure;
  });
  try {
    assert.throws(() => vm.run(), error => error === failure);
    assert.equal(vm.state, 'waiting');
    assert.equal(vm.fault, null);
    assert.equal(count(vm), 1);
    dispose();
    vm.scheduler.advance(10);
    assert.equal(vm.run().state, 'waiting');
    assert.equal(count(vm), 2);
    vm.scheduler.advance(10);
    assert.equal(vm.run().state, 'terminated');
    assert.equal(count(vm), 2);
    assert(vm.runtimeEvents.dropped > 0);
    assert.equal(vm.runtimeEvents.read().filter(event => event.name === RuntimeEventName.Suspend).length, 0);
  } finally { dispose(); vm.stop(); }
});

test('CIL: event transitions still work when profiling is disabled', () => {
  const vm = make('cil', sleep, {runtimeEvents: true, profile: false});
  try {
    assert.equal(vm.run().state, 'waiting');
    vm.scheduler.advance(10);
    assert.equal(vm.run().output, 'awake');
    assert.equal(instructionProfile(vm), null);
    assert.deepEqual(vm.runtimeEvents.read().filter(event => ['Suspend', 'Resume'].includes(event.name))
      .map(event => event.name), ['Suspend', 'Resume']);
  } finally { vm.stop(); }
});
