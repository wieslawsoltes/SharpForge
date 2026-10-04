import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, ManagedHeap, RuntimeEventName, instructionProfile} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const fixture = () => managedFixture({methods: [{name: 'Main', result: 'int',
  body: writer => writer.op('ldc.i4.7').op('ret')}]});
const gcEvents = vm => vm.runtimeEvents.read().filter(event =>
  event.name === RuntimeEventName.GCStart || event.name === RuntimeEventName.GCEnd);

test('CIL collection events report exact managed changes without retaining unreachable values', () => {
  const vm = new CilVirtualMachine(fixture(), {runtimeEvents: true});
  const delivered = [];
  const unsubscribe = vm.runtimeEvents.subscribe(event => delivered.push(event));
  try {
    const kept = vm.heap.string('kept'), garbage = vm.heap.string('garbage');
    const strong = vm.heap.createHandle(kept), weak = vm.heap.createHandle(garbage, {weak: true});
    const before = {...vm.heap.stats};
    const result = vm.heap.collect();
    assert.equal(vm.heap.get(kept).data, 'kept');
    assert.equal(vm.heap.getHandle(weak), null);
    assert.throws(() => vm.heap.get(garbage), {name: 'InvalidReferenceException'});
    const events = gcEvents(vm);
    assert.deepEqual(events.map(event => event.name), ['GCStart', 'GCEnd']);
    assert.deepEqual(events[0].payload, {collection: before.collections + 1,
      liveBytes: before.liveBytes, liveObjects: before.liveObjects});
    assert.deepEqual(events[1].payload, {collection: result.collections,
      liveBytes: result.liveBytes, liveObjects: result.liveObjects,
      freedObjects: result.freedThisCollection, freedBytes: result.bytesThisCollection});
    assert.equal(result.freedThisCollection, 1);
    assert.equal(result.bytesThisCollection, 38);
    assert(events.every(event => event.instruction === 0 && Object.isFrozen(event.payload)));
    assert.deepEqual(delivered, [], 'collection never invokes subscribers');
    assert.equal(vm.run().returnValue, 7);
    assert.equal(delivered.filter(event => event.name === RuntimeEventName.GCEnd).length, 1);
    vm.heap.releaseHandle(strong);
    vm.heap.releaseHandle(weak);
  } finally { unsubscribe(); vm.stop(); }
});

test('threshold collections preserve pending allocation roots and independent profiling', () => {
  const vm = new CilVirtualMachine(fixture(), {runtimeEvents: true, profile: true});
  try {
    const child = vm.heap.string('child');
    vm.heap.threshold = vm.heap.stats.liveBytes;
    const parent = vm.heap.object('System.Object', [child]);
    assert.equal(vm.heap.get(vm.heap.get(parent).data[0]).data, 'child');
    assert.deepEqual(gcEvents(vm).map(event => event.name), ['GCStart', 'GCEnd']);
    assert.equal(gcEvents(vm)[1].payload.freedObjects, 0);
    assert.equal(instructionProfile(vm).allocations, 2);
    assert.equal(vm.run().returnValue, 7);
  } finally { vm.stop(); }
});

test('same-VM restore retains event history while managed collection counters rewind', () => {
  const vm = new CilVirtualMachine(fixture(), {runtimeEvents: true});
  const keys = Object.keys(vm), heapKeys = Object.keys(vm.heap);
  try {
    const snapshot = vm.snapshot();
    vm.heap.collect();
    vm.restore(snapshot);
    vm.heap.collect();
    const events = gcEvents(vm);
    assert.deepEqual(events.map(event => event.payload.collection), [1, 1, 1, 1]);
    assert(events.every((event, index) => !index || event.sequence > events[index - 1].sequence));
    assert.deepEqual(Object.keys(vm), keys);
    assert.deepEqual(Object.keys(vm.heap), heapKeys);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 7);
  } finally { vm.stop(); }
});

test('GC subscriber failures propagate only at the host boundary after collection completes', () => {
  const vm = new CilVirtualMachine(fixture(), {runtimeEvents: true});
  const failure = new Error('GC host observer');
  const unsubscribe = vm.runtimeEvents.subscribe(event => {
    if (event.name === RuntimeEventName.GCEnd) throw failure;
  });
  try {
    assert.doesNotThrow(() => vm.heap.collect());
    assert.equal(vm.heap.stats.collections, 1);
    assert.throws(() => vm.run(), error => error === failure);
    assert.equal(vm.state, 'terminated');
    assert.equal(vm.returnValue, 7);
    assert.equal(vm.fault, null);
  } finally { unsubscribe(); vm.stop(); }
});

test('failed collections do not invent completion and bounded logs retain their drop policy', () => {
  const vm = new CilVirtualMachine(fixture(), {runtimeEvents: {capacity: 2}});
  try {
    const provider = vm.heap.rootProvider;
    const failure = new Error('root provider');
    vm.heap.rootProvider = () => { throw failure; };
    assert.throws(() => vm.heap.collect(), error => error === failure);
    assert.equal(gcEvents(vm).at(-1).name, RuntimeEventName.GCStart);
    assert.equal(vm.heap.stats.collections, 0);
    vm.heap.rootProvider = provider;
    vm.heap.collect();
    assert.deepEqual(vm.runtimeEvents.read().map(event => event.name), ['GCStart', 'GCEnd']);
    assert(vm.runtimeEvents.dropped >= 3);
  } finally { vm.stop(); }
});

test('unobserved heaps keep ordinary collection and optional instrumentation configuration', () => {
  const heap = new ManagedHeap();
  heap.string('garbage');
  assert.equal(heap.collect().freedThisCollection, 1);
  for (const runtimeEvents of [undefined, false]) {
    const vm = new CilVirtualMachine(fixture(), {runtimeEvents, profile: true, wasmTiering: true});
    try {
      vm.heap.collect();
      assert.equal(vm.runtimeEvents, null);
      assert.equal(vm.run().returnValue, 7);
      assert.equal(instructionProfile(vm).instructions, 2);
    } finally { vm.stop(); }
  }
});
