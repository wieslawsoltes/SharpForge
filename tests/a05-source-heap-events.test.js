import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, RuntimeEventName, instructionProfile} from '@sharpforge/runtime';

const empty = 'class Program { static void Main() {} }';
const guest = `class Program { static void Main() {
  int[] values = new int[2]; values[0] = 7; GC.Collect(); Console.WriteLine(values[0]);
} }`;
const isHeapEvent = event => ['AllocationTick', 'GCStart', 'GCEnd'].includes(event.name);
const heapEvents = vm => vm.runtimeEvents.read().filter(isHeapEvent);
const subscribeHeap = (vm, callback, options) => vm.runtimeEvents.subscribe(event => {
  if (isHeapEvent(event)) callback(event);
}, options);

function artifact(source = empty) {
  const result = compileToIL(source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

function make(engine, options = {}, source = empty) {
  const compiled = artifact(source);
  return new VirtualMachine(engine === 'source' ? compiled.image : compiled.assembly, options);
}

for (const engine of ['source', 'reload']) {
  test(`${engine}: guest heap events preserve output and instruction counts with either profiler setting`, () => {
    const plain = make(engine, {}, guest);
    try {
      const expected = plain.run();
      assert.equal(expected.state, 'terminated', expected.fault?.message);
      assert.equal(expected.output, '7\n');
      for (const profile of [false, true]) {
        const vm = make(engine, {runtimeEvents: true, profile}, guest), delivered = [];
        const unsubscribe = subscribeHeap(vm, event => delivered.push(event));
        try {
          const actual = vm.run(), events = heapEvents(vm);
          assert.equal(actual.state, 'terminated', actual.fault?.message);
          assert.equal(actual.output, expected.output);
          assert.equal(actual.stats.instructions, expected.stats.instructions);
          assert.deepEqual(delivered, events);
          const allocation = events.find(event => event.name === RuntimeEventName.AllocationTick);
          const start = events.find(event => event.name === RuntimeEventName.GCStart);
          const end = events.find(event => event.name === RuntimeEventName.GCEnd);
          assert(allocation.instruction > 0);
          assert(allocation.sequence < start.sequence && start.sequence < end.sequence);
          assert.equal(end.payload.collection, start.payload.collection);
          if (profile) assert.equal(instructionProfile(vm).allocatedBytes, vm.heap.stats.allocatedBytes);
        } finally { unsubscribe(); vm.stop(); }
      }
    } finally { plain.stop(); }
  });

  test(`${engine}: host heap events are committed, scalar, deferred and do not retain objects`, () => {
    const vm = make(engine, {runtimeEvents: true, profile: true}), delivered = [];
    const unsubscribe = subscribeHeap(vm, event => delivered.push(event));
    try {
      const before = {...vm.heap.stats}, cursor = vm.runtimeEvents.sequence;
      const weak = vm.heap.createHandle(vm.heap.string('abc'), {weak: true});
      const allocation = vm.runtimeEvents.read({after: cursor})[0];
      assert.equal(allocation.name, 'AllocationTick');
      assert.equal(allocation.instruction, 0);
      assert.deepEqual(allocation.payload, {bytes: 30, growth: false, allocations: before.allocations + 1,
        allocatedBytes: before.allocatedBytes + 30, liveBytes: before.liveBytes + 30});
      assert(Object.isFrozen(allocation.payload));
      vm.heap.collect();
      assert.equal(vm.heap.getHandle(weak), null);
      assert.deepEqual(delivered, []);
      vm.runSlice({instructionBudget: 0});
      assert.deepEqual(delivered.map(event => event.name), ['AllocationTick', 'GCStart', 'GCEnd']);
      assert.equal(instructionProfile(vm).allocatedBytes, 30);
      vm.heap.releaseHandle(weak);
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: entry argv allocations use the same log before the first instruction`, () => {
    const vm = make(engine, {runtimeEvents: true, programArguments: ['entry']},
      'class Program { static void Main(string[] args) { Console.WriteLine(args[0]); } }');
    const delivered = [], unsubscribe = subscribeHeap(vm, event => delivered.push(event), {replay: true});
    try {
      const initial = heapEvents(vm);
      assert.equal(initial.length, 2);
      assert(initial.every(event => event.name === 'AllocationTick' && event.instruction === 0));
      assert.deepEqual(initial.map(event => event.payload.bytes), [40, 34]);
      assert.deepEqual(delivered, []);
      assert.equal(vm.run().output, 'entry\n');
      assert.deepEqual(delivered.slice(0, 2), initial);
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: restore retains host history and subscriber cursors without guest schema fields`, () => {
    const vm = make(engine, {runtimeEvents: true}), delivered = [];
    const log = vm.runtimeEvents, keys = Object.keys(vm), heapKeys = Object.keys(vm.heap);
    const unsubscribe = subscribeHeap(vm, event => delivered.push(event));
    try {
      const snapshot = vm.snapshot();
      assert.equal(Object.hasOwn(vm, 'runtimeEvents'), false);
      assert.equal(Object.hasOwn(snapshot, 'runtimeEvents'), false);
      vm.heap.string('one');
      vm.runSlice({instructionBudget: 0});
      const first = delivered.at(-1), history = heapEvents(vm);
      vm.restore(snapshot);
      assert.equal(vm.runtimeEvents, log);
      assert.deepEqual(heapEvents(vm), history);
      vm.runSlice({instructionBudget: 0});
      assert.deepEqual(delivered, [first], 'restore does not replay already delivered events');
      vm.heap.string('two');
      vm.runSlice({instructionBudget: 0});
      assert.equal(delivered.length, 2);
      assert.deepEqual(delivered[1].payload, first.payload);
      assert(delivered[1].sequence > first.sequence);
      assert.deepEqual(Object.keys(vm), keys);
      assert.deepEqual(Object.keys(vm.heap), heapKeys);
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: subscriber failures escape after execution and stop performs cleanup first`, () => {
    const vm = make(engine, {runtimeEvents: true}), failure = new Error('host observer');
    const snapshot = vm.snapshot();
    let stopping = false;
    const unsubscribe = subscribeHeap(vm, () => {
      assert.equal(vm.state, 'terminated');
      assert.equal(vm.frames.length, 0);
      if (stopping) {
        assert.deepEqual(vm.stack, []);
        assert.equal(vm.platform.hostOperations.closed, true);
      }
      throw failure;
    });
    try {
      assert.doesNotThrow(() => vm.heap.string('before run'));
      assert.throws(() => vm.run(), error => error === failure);
      assert.equal(vm.fault, null);
      assert.equal(vm.pendingFault, null);
      vm.restore(snapshot);
      assert(vm.frames.length > 0);
      vm.scheduler.ensure();
      vm.heap.string('before stop');
      stopping = true;
      assert.throws(() => vm.stop(), error => error === failure);
      assert.equal(vm.state, 'terminated');
      assert.equal(vm.frames.length, 0);
      assert.equal(vm.currentPoint, null);
      assert([...vm.scheduler.contexts.values()].every(context => context.status === 'canceled'));
      assert.doesNotThrow(() => vm.stop(), 'a failed callback is not replayed');
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: event callback time is excluded from source duration profiling`, () => {
    let now = 0;
    const vm = make(engine, {runtimeEvents: true, profile: {duration: true, clock: () => now},
      onOutput: () => { now += 2; }}, 'class Program { static void Main() { Console.Write("tick"); } }');
    const unsubscribe = vm.runtimeEvents.subscribe(() => { now += 1000; });
    try {
      vm.heap.string('queued');
      assert.equal(vm.run().output, 'tick');
      assert.equal(instructionProfile(vm).duration.totalMilliseconds, 2);
      assert(now >= 1002);
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: capacity and cancellation use the existing bounded event log`, () => {
    const vm = make(engine, {runtimeEvents: {capacity: 2}}), delivered = [];
    const abort = new AbortController();
    const unsubscribe = vm.runtimeEvents.subscribe(event => delivered.push(event), {signal: abort.signal});
    try {
      const before = vm.runtimeEvents.sequence;
      for (const text of ['a', 'b', 'c']) vm.heap.string(text);
      assert.equal(vm.runtimeEvents.dropped, before + 3 - vm.runtimeEvents.capacity);
      assert.deepEqual(vm.runtimeEvents.read().map(event => event.sequence), [before + 2, before + 3]);
      abort.abort();
      vm.stop();
      assert.deepEqual(delivered, []);
      assert.equal(vm.runtimeEvents.subscribers.size, 0);
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`${engine}: disabled and malformed event options retain an explicit capability boundary`, () => {
    const compiled = artifact();
    const image = engine === 'source' ? compiled.image : compiled.assembly;
    for (const runtimeEvents of [undefined, false]) {
      const vm = new VirtualMachine(image, {runtimeEvents, profile: true});
      try {
        vm.heap.string('abc');
        assert.equal(vm.runtimeEvents, null);
        assert.equal(instructionProfile(vm).allocatedBytes, 30);
        assert.equal(vm.run().state, 'terminated');
      } finally { vm.stop(); }
    }
    for (const runtimeEvents of [null, 0, 'true', []]) {
      assert.throws(() => new VirtualMachine(image, {runtimeEvents}), /runtimeEvents/);
    }
    assert.throws(() => new VirtualMachine(image, {runtimeEvents: {capacity: 0}}), /event capacity/);
  });
}
