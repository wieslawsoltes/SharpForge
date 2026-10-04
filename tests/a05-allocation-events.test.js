import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, ManagedHeap, RuntimeEventName, instructionProfile} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const fixture = () => managedFixture({methods: [{name: 'Main', result: 'int',
  body: writer => writer.op('ldc.i4.7').op('ret')}]});
const ticks = vm => vm.runtimeEvents.read().filter(event => event.name === RuntimeEventName.AllocationTick);

test('allocation ticks contain committed scalar accounting and defer subscribers', () => {
  const vm = new CilVirtualMachine(fixture(), {runtimeEvents: true, profile: true});
  const delivered = [], unsubscribe = vm.runtimeEvents.subscribe(event => delivered.push(event));
  try {
    const before = {...vm.heap.stats};
    const reference = vm.heap.string('abc');
    const weak = vm.heap.createHandle(reference, {weak: true});
    const event = ticks(vm).at(-1);
    assert.deepEqual(event.payload, {bytes: 30, growth: false, allocations: before.allocations + 1,
      allocatedBytes: before.allocatedBytes + 30, liveBytes: before.liveBytes + 30});
    assert.equal(event.instruction, 0);
    assert(Object.isFrozen(event.payload));
    assert.deepEqual(delivered, []);
    assert.equal(instructionProfile(vm).allocatedBytes, 30);
    vm.heap.collect();
    assert.equal(vm.heap.getHandle(weak), null, 'the retained event does not root its allocation');
    assert.equal(vm.run().returnValue, 7);
    assert.equal(delivered.filter(item => item.name === RuntimeEventName.AllocationTick).length, 1);
    vm.heap.releaseHandle(weak);
  } finally { unsubscribe(); vm.stop(); }
});

test('guest allocation keeps output and instruction accounting identical with profiling off or on', () => {
  const assembly = managedFixture({methods: [{name: 'Main', result: 'int', body: (writer, context) => writer
    .op('ldc.i4.3').op('newarr', context.resolve('System.Int32')).op('pop').op('ldc.i4.7').op('ret')} ]});
  const plain = new CilVirtualMachine(assembly);
  try {
    const expected = plain.run();
    for (const profile of [false, true]) {
      const vm = new CilVirtualMachine(assembly, {runtimeEvents: true, profile});
      try {
        const actual = vm.run();
        assert.equal(actual.returnValue, expected.returnValue);
        assert.equal(actual.stats.instructions, expected.stats.instructions);
        assert.deepEqual(ticks(vm).map(event => [event.instruction, event.payload.bytes, event.payload.growth]), [[2, 44, false]]);
        assert.deepEqual(vm.runtimeEvents.read().map(event => event.name),
          ['MethodLoad', 'MethodEnter', 'AllocationTick', 'MethodLeave']);
        if (profile) assert.equal(instructionProfile(vm).allocations, 1);
      } finally { vm.stop(); }
    }
  } finally { plain.stop(); }
});

test('positive storage growth records only its delta and does not invent another object', () => {
  const vm = new CilVirtualMachine(fixture(), {runtimeEvents: true, profile: true});
  try {
    const array = vm.heap.array('int', 1);
    assert(vm.heap.get(array).data instanceof Int32Array);
    assert.equal(vm.heap.get(array).size, 32 + Int32Array.BYTES_PER_ELEMENT);
    vm.heap.replaceData(array, [1, 2, 3]);
    assert(vm.heap.get(array).data instanceof Int32Array);
    assert.equal(vm.heap.get(array).size, 32 + 3 * Int32Array.BYTES_PER_ELEMENT);
    vm.heap.replaceData(array, [3, 2, 1]);
    vm.heap.replaceData(array, [9]);
    assert.deepEqual(ticks(vm).map(event => event.payload), [
      {bytes: 36, growth: false, allocations: 1, allocatedBytes: 36, liveBytes: 36},
      {bytes: 8, growth: true, allocations: 1, allocatedBytes: 44, liveBytes: 44}
    ]);
    assert.equal(vm.heap.stats.liveBytes, 36);
    const profile = instructionProfile(vm);
    assert.equal(profile.allocations, 1);
    assert.equal(profile.allocatedBytes, 44);
  } finally { vm.stop(); }
});

test('threshold collection precedes allocation and failed reservation emits no tick', () => {
  const vm = new CilVirtualMachine(fixture(), {runtimeEvents: true});
  try {
    const child = vm.heap.string('child');
    vm.heap.threshold = vm.heap.stats.liveBytes;
    const cursor = vm.runtimeEvents.sequence;
    const parent = vm.heap.object('System.Object', [child]);
    assert.equal(vm.heap.get(vm.heap.get(parent).data[0]).data, 'child');
    assert.deepEqual(vm.runtimeEvents.read({after: cursor}).map(event => event.name), ['GCStart', 'GCEnd', 'AllocationTick']);
    const count = ticks(vm).length;
    vm.heap.maxBytes = 1;
    assert.throws(() => vm.heap.string('too large'), {name: 'OutOfMemoryException'});
    assert.throws(() => vm.heap.replaceData(parent, [child, child]), {name: 'OutOfMemoryException'});
    assert.equal(ticks(vm).length, count);
    assert.equal(vm.heap.get(parent).data.length, 1);
  } finally { vm.stop(); }
});

test('restore keeps event chronology while allocation counters rewind without extra state fields', () => {
  const vm = new CilVirtualMachine(fixture(), {runtimeEvents: true});
  const keys = Object.keys(vm), heapKeys = Object.keys(vm.heap);
  try {
    const snapshot = vm.snapshot();
    vm.heap.string('one');
    const first = ticks(vm).at(-1);
    vm.restore(snapshot);
    vm.heap.string('two');
    const second = ticks(vm).at(-1);
    assert.deepEqual(second.payload, first.payload);
    assert(second.sequence > first.sequence);
    assert.deepEqual(Object.keys(vm), keys);
    assert.deepEqual(Object.keys(vm.heap), heapKeys);
  } finally { vm.stop(); }
});

test('allocation subscriber failures remain host errors after the guest completes', () => {
  const vm = new CilVirtualMachine(fixture(), {runtimeEvents: true});
  const failure = new Error('allocation observer');
  const unsubscribe = vm.runtimeEvents.subscribe(event => {
    if (event.name === RuntimeEventName.AllocationTick) throw failure;
  });
  try {
    assert.doesNotThrow(() => vm.heap.string('committed'));
    assert.throws(() => vm.run(), error => error === failure);
    assert.equal(vm.state, 'terminated');
    assert.equal(vm.returnValue, 7);
    assert.equal(vm.fault, null);
  } finally { unsubscribe(); vm.stop(); }
});

test('ticks share bounded log overflow and subscription disposal', () => {
  const vm = new CilVirtualMachine(fixture(), {runtimeEvents: {capacity: 2}}), delivered = [];
  const unsubscribe = vm.runtimeEvents.subscribe(event => delivered.push(event));
  try {
    const before = vm.runtimeEvents.dropped;
    for (const value of ['a', 'b', 'c']) vm.heap.string(value);
    assert.deepEqual(vm.runtimeEvents.read().map(event => event.name), ['AllocationTick', 'AllocationTick']);
    assert.equal(vm.runtimeEvents.dropped, before + 3);
    unsubscribe();
    vm.stop();
    assert.deepEqual(delivered, []);
  } finally { unsubscribe(); vm.stop(); }
});

test('standalone and unobserved heaps retain ordinary allocation and profiling behavior', () => {
  const heap = new ManagedHeap();
  const reference = heap.string('plain');
  assert.equal(heap.get(reference).data, 'plain');
  for (const runtimeEvents of [undefined, false]) {
    const vm = new CilVirtualMachine(fixture(), {runtimeEvents, profile: true});
    try {
      vm.heap.string('abc');
      assert.equal(vm.runtimeEvents, null);
      assert.equal(instructionProfile(vm).allocatedBytes, 30);
      assert.equal(vm.run().returnValue, 7);
    } finally { vm.stop(); }
  }
});
