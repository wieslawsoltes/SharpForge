import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, RuntimeEventName, framePoolStatistics, instructionProfile} from '@sharpforge/runtime';

const calls = `class Program {
  static int Increment(int value) { return value + 1; }
  static void Main() { Console.WriteLine(Increment(Increment(40))); }
}`;
const parked = `using System.Threading; using System.Threading.Tasks;
class Program {
  static void Park() { Thread.Sleep(60000); }
  static void Worker() { Park(); Console.Write("resumed"); }
  static void Main() { Task.Run(Worker); }
}`;
const compiled = new Map();
function make(engine, source = calls, options = {}) {
  let artifact = compiled.get(source);
  if (!artifact) {
    artifact = compileToIL(source);
    assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
    compiled.set(source, artifact);
  }
  return new VirtualMachine(engine === 'source' ? artifact.image : artifact.assembly, {runtimeEvents: true, ...options});
}
const methodEvents = vm => vm.runtimeEvents.read().filter(event =>
  event.name === RuntimeEventName.MethodEnter || event.name === RuntimeEventName.MethodLeave);
const nameOf = (vm, event) => vm.image.methods[event.payload.method].name;
const leaves = vm => methodEvents(vm).filter(event => event.name === RuntimeEventName.MethodLeave);

function balanced(events) {
  const active = new Map();
  for (const event of events) {
    const {method, frame} = event.payload;
    assert(Number.isSafeInteger(method) && Number.isSafeInteger(frame));
    assert.deepEqual(Object.keys(event.payload).sort(), ['frame', 'method', 'reason']);
    assert(Object.isFrozen(event.payload));
    if (event.name === RuntimeEventName.MethodEnter) {
      assert.equal(active.has(frame), false, 'No duplicate entry for an observed span');
      active.set(frame, method);
    } else {
      assert.equal(active.get(frame), method, 'Exactly one leave belongs to each admitted/restored span');
      active.delete(frame);
    }
  }
  assert.equal(active.size, 0);
}

function pauseIn(vm, name) {
  for (let count = 0; count < 500; count++) {
    if (vm.top && vm.image.methods[vm.top.methodId].name === name) return;
    assert(['ready', 'running'].includes(vm.state));
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
  }
  assert.fail('Did not reach ' + name);
}

function waitingChild(vm) {
  assert.equal(vm.run().state, 'waiting', vm.fault?.message);
  assert.equal(vm.scheduler.parked, true);
  const child = [...vm.scheduler.contexts.values()].find(context => context.kind === 'task');
  assert(child);
  assert.deepEqual(child.frames.map(frame => vm.image.methods[frame.methodId].name), ['Worker', 'Park']);
  return child;
}

for (const engine of ['source', 'reload']) {
  test(`${engine}: successful calls emit ordered entries/exits with fresh pooled frame identities`, () => {
    const vm = make(engine, calls, {profile: true}), plain = make(engine, calls, {runtimeEvents: false, profile: true});
    const delivered = [], unsubscribe = vm.runtimeEvents.subscribe(event => delivered.push(event), {replay: true});
    try {
      assert.deepEqual(delivered, []);
      const expected = plain.run(), actual = vm.run();
      assert.equal(actual.state, 'terminated', actual.fault?.message);
      assert.equal(actual.output, '42\n');
      assert.equal(actual.output, expected.output);
      assert.equal(actual.stats.instructions, expected.stats.instructions);
      const events = methodEvents(vm);
      const selected = events.filter(event => ['Main', 'Increment'].includes(nameOf(vm, event)));
      assert.deepEqual(selected.map(event => [event.name, nameOf(vm, event)]), [
        ['MethodEnter', 'Main'], ['MethodEnter', 'Increment'], ['MethodLeave', 'Increment'],
        ['MethodEnter', 'Increment'], ['MethodLeave', 'Increment'], ['MethodLeave', 'Main']
      ]);
      assert(selected.every(event => event.payload.reason === (event.name === 'MethodEnter' ? 'call' : 'return')));
      assert.equal(new Set(selected.filter(event => event.name === 'MethodEnter').map(event => event.payload.frame)).size, 3);
      assert(framePoolStatistics(vm).reused > 0);
      assert.deepEqual(instructionProfile(vm), instructionProfile(plain));
      assert.deepEqual(delivered, vm.runtimeEvents.read());
      balanced(events);
    } finally { unsubscribe(); vm.stop(); plain.stop(); }
  });

  test(`${engine}: failed frame admission emits no entry or later synthetic leave`, () => {
    const vm = make(engine);
    try {
      const method = vm.image.methods.find(method => method.name === 'Increment');
      const history = vm.runtimeEvents.export(), frames = vm.frames.slice();
      vm.options.maxFrames = vm.frames.length;
      assert.throws(() => vm.call(method.id, [41]), {name: 'StackOverflowException'});
      assert.deepEqual(vm.frames, frames);
      assert.deepEqual(vm.runtimeEvents.export(), history);
      vm.stop();
      balanced(methodEvents(vm));
      assert.equal(methodEvents(vm).some(event => event.payload.method === method.id), false);
    } finally { vm.stop(); }
  });

  test(`${engine}: finally runs before the exceptional leave and a local catch does not close its frame`, () => {
    const source = `class Program {
      static void Fail() { try { throw new Exception("bad"); } finally { Console.Write("finally"); } }
      static void Main() { try { Fail(); } catch (Exception) { Console.Write("caught"); } }
    }`;
    const observed = [];
    const vm = make(engine, source, {onOutput: text => observed.push([text,
      leaves(vm).filter(event => nameOf(vm, event) === 'Fail').map(event => event.payload.reason)])});
    try {
      assert.equal(vm.run().output, 'finallycaught');
      assert.deepEqual(observed, [['finally', []], ['caught', ['exception']]]);
      assert.deepEqual(leaves(vm).filter(event => nameOf(vm, event) === 'Main').map(event => event.payload.reason), ['return']);
      balanced(methodEvents(vm));
    } finally { vm.stop(); }
  });

  test(`${engine}: finally return and rethrow each produce a single real frame exit`, () => {
    for (const [body, state, reason, output] of [
      ['try { return 42; } finally { Console.Write("finally"); }', 'terminated', 'return', 'finally42\n'],
      ['try { throw new Exception("bad"); } catch (Exception) { throw; }', 'faulted', 'exception', '']
    ]) {
      const vm = make(engine, `class Program { static int Child() { ${body} }
        static void Main() { Console.WriteLine(Child()); } }`);
      try {
        const result = vm.run();
        assert.equal(result.state, state, result.fault?.message);
        assert.equal(result.output, output);
        assert.deepEqual(leaves(vm).filter(event => nameOf(vm, event) === 'Child').map(event => event.payload.reason), [reason]);
        balanced(methodEvents(vm));
      } finally { vm.stop(); }
    }
  });

  test(`${engine}: successful restore restarts spans; rejected restore changes no observations`, () => {
    const vm = make(engine), delivered = [];
    const log = vm.runtimeEvents, unsubscribe = log.subscribe(event => delivered.push(event.sequence), {replay: true});
    try {
      pauseIn(vm, 'Increment');
      const snapshot = vm.snapshot(), frames = vm.frames.map(frame => ({method: frame.methodId, frame: frame.id}));
      const history = log.export();
      assert.equal(Object.hasOwn(snapshot, 'runtimeEvents'), false);
      assert.throws(() => vm.restore({...snapshot, owner: {}}), /another source VM/);
      assert.deepEqual(log.export(), history);
      vm.restore(snapshot);
      assert.equal(vm.runtimeEvents, log);
      const changed = log.read({after: history.sequence});
      assert.deepEqual(changed.map(event => [event.name, event.payload]), [
        ...frames.toReversed().map(frame => ['MethodLeave', {...frame, reason: 'restore'}]),
        ...frames.map(frame => ['MethodEnter', {...frame, reason: 'restore'}])
      ]);
      assert.equal(delivered.at(-1), history.sequence, 'restore records but does not call subscribers');
      assert.equal(vm.run().output, '42\n');
      balanced(methodEvents(vm));
      assert(delivered.every((sequence, index) => index === 0 || sequence > delivered[index - 1]));
      const last = log.sequence;
      vm.stop();
      assert.equal(log.sequence, last);
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: debugger pauses and fatal inspection retain open spans until final cleanup`, () => {
    const vm = make(engine), delivered = [];
    const unsubscribe = vm.runtimeEvents.subscribe(event => delivered.push(event), {replay: true});
    try {
      vm.runSlice({onSequence: () => true, timeBudgetMs: 1000});
      assert.equal(vm.state, 'paused');
      assert.equal(leaves(vm).length, 0);
      vm.options.maxInstructions = vm.instructions;
      assert.equal(vm.run().state, 'faulted');
      assert.equal(vm.fault.name, 'InstructionLimitException');
      assert(vm.frames.length > 0);
      assert.equal(leaves(vm).length, 0, 'Inspectable fatal frames are still live');
      const frames = vm.frames.map(frame => frame.id);
      vm.stop();
      assert.deepEqual(leaves(vm).map(event => [event.payload.frame, event.payload.reason]),
        frames.toReversed().map(frame => [frame, 'stop']));
      balanced(methodEvents(vm));
      assert.deepEqual(delivered, vm.runtimeEvents.read());
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: parked cancellation emits inner-first exits only at the next host boundary`, () => {
    const vm = make(engine, parked, {virtualTime: true}), delivered = [];
    const unsubscribe = vm.runtimeEvents.subscribe(event => delivered.push(event), {replay: true});
    try {
      const child = waitingChild(vm), ids = child.frames.map(frame => frame.id);
      const childLeaves = () => leaves(vm).filter(event => ids.includes(event.payload.frame));
      vm.runSlice();
      assert.deepEqual(childLeaves(), []);
      vm.scheduler.cancelAll();
      assert.deepEqual(child.frames, []);
      assert.deepEqual(childLeaves(), []);
      vm.runSlice();
      assert.deepEqual(childLeaves().map(event => [event.payload.frame, event.payload.reason]),
        ids.toReversed().map(frame => [frame, 'canceled']));
      assert.deepEqual(delivered, vm.runtimeEvents.read());
      balanced(methodEvents(vm));
      const sequence = vm.runtimeEvents.sequence;
      vm.scheduler.cancelAll();
      vm.scheduler.advance(60000);
      vm.runSlice();
      vm.stop();
      assert.equal(vm.runtimeEvents.sequence, sequence);
      assert.equal(vm.output.join(''), '');
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: waking a parked invocation emits normal returns, including after snapshot restore`, () => {
    const vm = make(engine, parked, {virtualTime: true});
    try {
      const child = waitingChild(vm), ids = child.frames.map(frame => frame.id);
      const saved = vm.snapshot();
      vm.restore(saved);
      const restored = methodEvents(vm).filter(event => event.payload.reason === 'restore');
      assert.deepEqual(restored.map(event => [event.name, event.payload.frame]), [
        ...ids.toReversed().map(id => ['MethodLeave', id]), ...ids.map(id => ['MethodEnter', id])
      ]);
      vm.state = 'waiting';
      vm.scheduler.advance(60000);
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      assert.equal(vm.output.join(''), 'resumed');
      assert.deepEqual(leaves(vm).filter(event => event.payload.reason === 'return' && ids.includes(event.payload.frame))
        .map(event => event.payload.frame), ids.toReversed());
      balanced(methodEvents(vm));
    } finally { vm.stop(); }
  });

  test(`${engine}: stop disposes live frames before callbacks and emits no duplicate exits`, () => {
    const vm = make(engine), failure = new Error('host method subscriber');
    pauseIn(vm, 'Increment');
    const frames = vm.frames.map(frame => frame.id);
    const unsubscribe = vm.runtimeEvents.subscribe(event => {
      if (event.name !== 'MethodLeave') return;
      assert.equal(vm.state, 'terminated');
      assert.equal(vm.frames.length, 0);
      assert.equal(vm.platform.hostOperations.closed, true);
      throw failure;
    });
    try {
      assert.throws(() => vm.stop(), error => error === failure);
      assert.equal(vm.fault, null);
      assert.deepEqual(leaves(vm).map(event => [event.payload.frame, event.payload.reason]),
        frames.toReversed().map(frame => [frame, 'stop']));
      const sequence = vm.runtimeEvents.sequence;
      unsubscribe();
      vm.stop();
      assert.equal(vm.runtimeEvents.sequence, sequence);
      balanced(methodEvents(vm));
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: method events obey log capacity without keeping historical active frames`, () => {
    const vm = make(engine, calls, {runtimeEvents: {capacity: 2}});
    try {
      assert.equal(vm.run().output, '42\n');
      assert.equal(vm.runtimeEvents.read().length, 2);
      assert(vm.runtimeEvents.dropped > 0);
      const sequence = vm.runtimeEvents.sequence;
      vm.stop();
      assert.equal(vm.runtimeEvents.sequence, sequence, 'Finished spans are retired even if entries were dropped');
    } finally { vm.stop(); }
  });
}
