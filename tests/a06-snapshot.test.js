import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '@sharpforge/runtime';
import {copyHeapState, heapSnapshotSchemaVersion} from '../packages/runtime/src/gc/snapshot.js';

const makeHeap = options => new ManagedHeap({maxBytes: 8 * 1024 * 1024, initialThreshold: 8 * 1024 * 1024, ...options});

test('A06 snapshot: pending finalizers and short/long weak references replay identical behavior', () => {
  const heap = makeHeap();
  const log = [];
  const target = heap.object('Finalizable', [heap.string('payload')]);
  const short = heap.lifetime.createWeakReference(target);
  const long = heap.lifetime.createWeakReference(target, {trackResurrection: true});
  heap.lifetime.registerFinalizer(target, reference => log.push(heap.get(reference).type));
  heap.collect();
  assert.equal(short.target, null);
  assert.deepEqual(long.target, target);
  const saved = heap.snapshot();
  assert.equal(saved.schemaVersion, heapSnapshotSchemaVersion);
  for (let replay = 0; replay < 2; replay++) {
    if (replay) heap.restore(saved);
    const start = log.length;
    const drained = heap.lifetime.drainFinalizers();
    assert.equal(drained.fault, null);
    assert.equal(drained.completed, 1);
    assert.equal(drained.pending, 0);
    heap.collect();
    assert.deepEqual(log.slice(start), ['Finalizable']);
    assert.equal(short.target, null);
    assert.equal(long.target, null);
    assert.equal(heap.tryGet(target), null);
  }
});

test('A06 snapshot: pins, explicit root stack and conditional tables restore with original host tokens', () => {
  const heap = makeHeap();
  const key = heap.object('Key', []);
  const value = heap.object('Value', []);
  const owner = {name: 'test-owner'};
  const pin = heap.lifetime.pin(key, {owner});
  const table = heap.lifetime.createConditionalWeakTable();
  table.add(key, value);
  heap.pins.push(value);
  const saved = heap.snapshot();
  pin.dispose();
  table.remove(key);
  heap.pins.length = 0;
  heap.collect();
  assert.equal(heap.tryGet(key), null);
  heap.restore(saved);
  assert.equal(heap.lifetime.isPinned(key), true);
  assert.equal(heap.get(key).pinCount, 1);
  assert.deepEqual(heap.pins, [value]);
  assert.deepEqual(table.tryGetValue(key), {success: true, value});
  assert.equal(heap.lifetime.releaseOwner(owner).pins, 1);
  assert.equal(heap.lifetime.isPinned(key), false);
});

test('A06 snapshot: slot, host handle, allocation and address identities cannot alias a discarded future', () => {
  const heap = makeHeap();
  const old = heap.object('Old', []);
  const saved = heap.snapshot();
  const future = heap.object('Future', []);
  const futureHandle = heap.createHandle(future);
  const futurePin = heap.lifetime.pin(future);
  const allocated = heap.allocatedBytes64;
  heap.restore(saved);
  const replay = heap.object('Replay', []);
  const replayHandle = heap.createHandle(replay);
  const replayPin = heap.lifetime.pin(replay);
  assert.equal(heap.tryGet(old)?.type, 'Old');
  assert.equal(heap.tryGet(future), null);
  assert.equal(heap.getHandle(futureHandle), null);
  assert(replayHandle.id > futureHandle.id);
  assert(replayPin.id > futurePin.id);
  assert.notEqual(replayPin.address, futurePin.address);
  assert(heap.allocatedBytes64 > allocated);
  assert.equal(heap.stats.allocatedBytes64, heap.allocatedBytes64);
  if (replay.h === future.h) assert(replay.g > future.g);
});

test('A06 snapshot: partially marked graph, work cursor and remembered stores replay to the same live graph', () => {
  const heap = makeHeap({generational: true});
  const old = heap.object('Old', [null]);
  heap.rootProvider = () => [old];
  heap.collect();
  heap.collect();
  const child = heap.object('Young', [heap.string('leaf')]);
  heap.writeField(old, 0, child);
  for (let index = 0; index < 100; index++) heap.object('Unreachable', []);
  heap.collector.startIncremental({generation: 0});
  heap.collector.step(1);
  const saved = heap.snapshot();
  const finish = () => {
    for (let steps = 0; heap.collector.active && steps < 100_000; steps++) heap.collector.step(7);
    assert.equal(heap.collector.active, false);
    return {types: heap.census().types, liveBytes: heap.stats.liveBytes,
      generations: heap.records.map(record => record?.gcGeneration ?? null)};
  };
  const expected = finish();
  heap.restore(saved);
  assert.deepEqual(finish(), expected);
  assert.equal(heap.get(child).type, 'Young');
});

test('A06 snapshot: mutable graphs, views and accounting arrays do not alias saved state', () => {
  const heap = makeHeap({allocationSampling: true});
  heap.allocationSites.setCurrent({methodToken: 1, ilOffset: 8});
  const array = heap.array('int', 3);
  heap.writeElement(array, 1, 42);
  const saved = heap.snapshot();
  heap.writeElement(array, 1, 99);
  heap.stats.generationBytes[0] += 1;
  assert.equal(saved.records[array.h].data[1], 42);
  heap.restore(saved);
  assert.equal(heap.get(array).data[1], 42);
  heap.writeElement(array, 1, 7);
  assert.equal(saved.records[array.h].data[1], 42);
  const bytes = Object.freeze(new ArrayBuffer(8));
  const graph = {bytes, view: new DataView(bytes), map: new Map(), set: new Set()};
  graph.map.set('self', graph);
  graph.set.add(graph);
  graph.view.setInt32(0, 42);
  const copy = copyHeapState(graph);
  assert.equal(copy.map.get('self'), copy);
  assert(copy.set.has(copy));
  assert.equal(copy.view.buffer, copy.bytes);
  assert.notEqual(copy.bytes, bytes);
  assert.equal(copy.view.getInt32(0), 42);
  const fault = new Error('snapshot failure detail');
  fault.cause = fault;
  const copiedFault = copyHeapState(fault);
  assert.equal(copiedFault.message, 'snapshot failure detail');
  assert.equal(copiedFault.cause, copiedFault);
});

test('A06 snapshot: schema, owner, service, free-list and malformed counters reject before mutation', () => {
  const heap = makeHeap();
  const reference = heap.string('retained');
  const saved = heap.snapshot();
  const revision = heap.mutationRevision;
  const invalid = [
    {...saved, schemaVersion: 999},
    {...saved, owner: Object.freeze({})},
    {...saved, free: [reference.h]},
    {...saved, exactAllocations: '-1'},
    {...saved, services: {...saved.services, diagnostics: {version: 999}}},
    {...saved, services: {}}
  ];
  for (const state of invalid) {
    assert.throws(() => heap.restore(state));
    assert.equal(heap.mutationRevision, revision);
    assert.equal(heap.get(reference).data, 'retained');
  }
});

test('A06 snapshot: acquiring or releasing an actual host resource blocks rewind before heap mutation', () => {
  const heap = makeHeap();
  const resource = {descriptor: 7};
  const handle = heap.lifetime.createSafeHandle(resource, () => true);
  const saved = heap.snapshot();
  assert.equal(saved.services.lifetime.resources.entries[0][1].resource, resource);
  heap.restore(saved);
  assert.equal(handle.dangerousGetHandle(), resource);
  handle.dispose();
  const revision = heap.mutationRevision;
  assert.throws(() => heap.restore(saved), /host-resource/);
  assert.equal(heap.mutationRevision, revision);
});


test('A06 snapshot: frozen initializer cache preserves exact host-owner identity without traversing its graph', () => {
  const heap = new ManagedHeap({gcStress: false});
  const owner = {heap};
  Object.defineProperty(owner, 'unrelatedHostState', {enumerable: true, get() {
    assert.fail('Snapshot traversed an opaque frozen-source owner');
  }});
  const frozen = heap.spaces.frozen;
  const reference = frozen.source(owner, 'module:field', Uint8Array.of(1, 2, 3, 4));
  const state = heap.snapshot();
  assert.equal(state.services.spaces.frozen.dataSources[0][0], owner);
  frozen.dataSources.delete(owner);
  heap.restore(state);
  assert.equal(frozen.findSource(owner, 'module:field'), reference);
  assert.deepEqual([...heap.get(reference).data], [1, 2, 3, 4]);
  heap.dispose();
});
