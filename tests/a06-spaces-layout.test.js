import test from 'node:test';
import assert from 'node:assert/strict';
import {FreeSpaceIndex} from '../packages/runtime/src/gc/free-space-index.js';
import {SlotArena} from '../packages/runtime/src/gc/slot-arena.js';
import {createCompactionPlan, applyCompactionPlan} from '../packages/runtime/src/gc/compact-plan.js';

test('best-fit allocation chooses the smallest adequate hole and coalesces both neighbors', () => {
  const free = new FreeSpaceIndex();
  free.add(0, 32);
  free.add(64, 32);
  free.add(128, 80);
  assert.deepEqual(free.take(40), {offset: 128, size: 80});
  free.add(32, 32);
  assert.deepEqual(free.blocks(), [{offset: 0, size: 96}]);
  assert.equal(free.bytes, 96);
  assert.equal(free.largest, 96);
  assert.equal(free.take(97), null);
  assert.deepEqual(free.take(96), {offset: 0, size: 96});
  assert.equal(free.bytes, 0);
  assert.equal(free.largest, 0);
});

test('free-block AVL index preserves all candidates through adversarial ordered inserts and deletes', () => {
  const free = new FreeSpaceIndex();
  for (let index = 0; index < 256; index++) free.add(index * 4096, 8 * (index + 1));
  for (let size = 256; size > 0; size--) {
    const block = free.take(size * 8);
    assert.equal(block.size, size * 8);
    assert.equal(block.offset, (size - 1) * 4096);
  }
  assert.equal(free.bytes, 0);
  assert.equal(free.root, null);
  assert.throws(() => free.add(-1, 8), RangeError);
  assert.throws(() => free.add(0, 0), RangeError);
});

test('sliding host slot compaction preserves handles, references and pinned island offsets', () => {
  const arena = new SlotArena(1, 256);
  const dead = arena.allocate(1, 24);
  const pinned = arena.allocate(2, 24);
  const hole = arena.allocate(3, 40);
  const moving = arena.allocate(4, 40);
  const identity = Object.freeze({h: 7, g: 11});
  arena.write(pinned, 0, identity);
  arena.write(moving, 0, identity);
  arena.write(moving, 4, 42);
  const pinnedOffset = pinned.offset;
  arena.release(dead.id);
  arena.release(hole.id);
  const before = arena.memoryInfo();
  const plan = createCompactionPlan(arena, block => block.id === pinned.id);
  const result = applyCompactionPlan(arena, plan);
  assert.equal(pinned.offset, pinnedOffset);
  assert.equal(moving.offset, pinnedOffset + pinned.allocatedBytes);
  assert.strictEqual(arena.read(moving, 0), identity);
  assert.equal(arena.read(moving, 4), 42);
  assert.strictEqual(arena.read(pinned, 0), identity);
  assert.equal(result.movedObjects, 1);
  assert.equal(result.pinnedObjects, 1);
  assert.ok(arena.memoryInfo().fragmentedBytes < before.fragmentedBytes);
  assert.equal(arena.memoryInfo().fragmentedBytes, dead.allocatedBytes);
});

test('compaction rejects a stale plan instead of moving unrelated allocation contents', () => {
  const arena = new SlotArena(1, 64);
  arena.allocate(1, 16);
  arena.allocate(2, 16);
  arena.release(1);
  const plan = createCompactionPlan(arena, () => false);
  arena.release(2);
  assert.throws(() => applyCompactionPlan(arena, plan), /stale block plan/);
});

test('slot snapshots are independent of subsequent relocation and preserve backing values', () => {
  const arena = new SlotArena(1, 64);
  arena.allocate(1, 16);
  const live = arena.allocate(2, 16);
  arena.write(live, 0, 9);
  const savedOffset = live.offset;
  const snapshot = arena.snapshot();
  arena.release(1);
  applyCompactionPlan(arena, createCompactionPlan(arena, () => false));
  arena.write(live, 0, 27);
  const restored = SlotArena.restore(snapshot);
  assert.equal(restored.blocks.get(2).offset, savedOffset);
  assert.equal(restored.read(restored.blocks.get(2), 0), 9);
});
