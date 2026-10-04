import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/heap.js';
import {MemoryArena} from '../packages/runtime/src/gc/arena.js';
import {primitiveStorage} from '../packages/runtime/src/gc/primitive-storage.js';
import {createSpatialArrayView} from '../packages/runtime/src/gc/spatial-array-view.js';

const options = {maxBytes: 2 * 1024 * 1024, initialThreshold: 2 * 1024 * 1024, arenaSegmentBytes: 4096};

function assertAccounting(heap) {
  const info = heap.spaces.memoryInfo();
  assert.equal(info.liveBytes, heap.stats.liveBytes);
  assert.equal(info.objects, heap.stats.liveObjects);
  for (const space of ['small', 'large', 'pinned', 'frozen']) {
    const records = heap.records.filter(record => record?.space === space);
    assert.equal(info[space].objects, records.length);
    assert.equal(info[space].liveBytes, records.reduce((sum, record) => sum + record.size, 0));
    assert.equal(info[space].payloadBytes, records.reduce((sum, record) => sum + record.storage.byteLength, 0));
    assert.equal(info[space].stringMirrorBytes,
      records.reduce((sum, record) => sum + (record.kind === 'string' ? record.data.length * 2 : 0), 0));
  }
}

test('segment events describe actual reservations and final block releases exactly once', () => {
  const heap = new ManagedHeap(options);
  const first = heap.array('byte', 8);
  const second = heap.array('byte', 8);
  const segmentId = heap.get(first).storage.arenaId;
  assert.equal(heap.get(second).storage.arenaId, segmentId);
  const created = heap.events.read().events.filter(event => event.name === 'GCCreateSegment');
  assert.equal(created.length, 1);
  assert.equal(created[0].segmentId, segmentId);
  assert.equal(created[0].space, 'small');
  assert.equal(created[0].hostBacked, false);
  assert.equal(created[0].reservedBytes, 4096);
  heap.collect([second], {generation: 2});
  assert.equal(heap.events.read().events.filter(event => event.name === 'GCFreeSegment').length, 0);
  heap.collect([], {generation: 2});
  const released = heap.events.read().events.filter(event => event.name === 'GCFreeSegment');
  assert.equal(released.length, 1);
  assert.equal(released[0].segmentId, segmentId);
  assert.equal(released[0].reservedBytes, created[0].reservedBytes);
  assert.equal(heap.spaces.memoryInfo().reservedBytes, 0);
});

test('space totals survive resizing across the LOH boundary, rollback, compaction and restore', () => {
  const heap = new ManagedHeap(options);
  const array = heap.array('byte', 8);
  const pinned = heap.array('int', 3, {pinned: true});
  heap.spaces.frozen.string('frozen mirror');
  heap.rootProvider = () => [array, pinned];
  assertAccounting(heap);
  heap.replaceData(array, Array(85_000).fill(2));
  assert.equal(heap.get(array).space, 'large');
  assertAccounting(heap);
  const snapshot = heap.snapshot();
  heap.replaceData(array, [7]);
  assert.equal(heap.get(array).space, 'small');
  assertAccounting(heap);
  const beforeFailure = heap.spaces.memoryInfo();
  assert.throws(() => heap.allocate('array', 'bool[]', [false, {}]), TypeError);
  assert.deepEqual(heap.spaces.memoryInfo(), beforeFailure);
  heap.collect([], {generation: 2, compacting: true});
  assertAccounting(heap);
  heap.restore(snapshot);
  assert.equal(heap.get(array).space, 'large');
  assert.equal(heap.get(array).data.length, 85_000);
  assertAccounting(heap);
});

test('large primitive releases invalidate views without clearing payload, and reuse zeroes every exposed byte', () => {
  const arena = new MemoryArena(1, 4 * 1024 * 1024);
  const length = 3 * 1024 * 1024 + 3;
  const block = arena.allocate(1, length);
  const codec = primitiveStorage('System.Byte');
  const view = createSpatialArrayView({arena, block, codec, length, readOnly: false});
  arena.bytes.fill(0xa5, block.offset, block.offset + block.allocatedBytes);
  const neighbor = arena.allocate(2, 8);
  arena.bytes.fill(42, neighbor.offset, neighbor.offset + 8);
  arena.release(block.id);
  assert.throws(() => view[0], {name: 'InvalidReferenceException'});
  assert.throws(() => { view[length - 1] = 1; }, {name: 'InvalidReferenceException'});
  assert.equal(arena.bytes[block.offset], 0xa5, 'sweeping does not touch a large primitive payload');
  assert.equal(arena.bytes[block.offset + block.allocatedBytes - 1], 0xa5);
  const replacement = arena.allocate(3, length);
  assert.equal(replacement.offset, block.offset);
  assert.equal(arena.bytes.subarray(replacement.offset, replacement.offset + replacement.allocatedBytes).every(value => value === 0), true);
  assert.equal(arena.bytes.subarray(neighbor.offset, neighbor.offset + 8).every(value => value === 42), true);
});
