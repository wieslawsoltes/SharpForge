import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryArena} from '../packages/runtime/src/gc/arena.js';
import {SlotArena} from '../packages/runtime/src/gc/slot-arena.js';
import {ArenaAllocationIndex, ArenaAllocationPool} from '../packages/runtime/src/gc/arena-allocation-index.js';
import {createCompactionPlan, applyCompactionPlan} from '../packages/runtime/src/gc/compaction.js';

test('arena pools preserve space and representation separation', () => {
  const index = new ArenaAllocationIndex();
  const smallBytes = new MemoryArena(1, 128, 'small');
  const largeBytes = new MemoryArena(2, 128, 'large');
  const smallSlots = new SlotArena(3, 128, 'small');
  for (const arena of [smallBytes, largeBytes, smallSlots]) index.pool(arena.space, arena.hostBacked).add(arena);
  assert.strictEqual(index.pool('small', false).find(16), smallBytes);
  assert.strictEqual(index.pool('large', false).find(16), largeBytes);
  assert.strictEqual(index.pool('small', true).find(16), smallSlots);
  assert.equal(index.pool('pinned', false).find(16), null);
  assert.throws(() => index.pool('small', false).add(smallBytes), /duplicate arena/);
  index.clear();
  assert.equal(index.pool('small', false).find(16), null);
  assert.equal(smallBytes.free.observer, null);
});

test('global best fit chooses the smallest hole or tail across segments', () => {
  const pool = new ArenaAllocationPool();
  const first = new MemoryArena(1, 128);
  const second = new MemoryArena(2, 160);
  for (let id = 1; id <= 3; id++) {
    first.allocate(id, 32);
    second.allocate(id, 40);
  }
  first.release(1);
  second.release(1);
  pool.add(second);
  pool.add(first);
  assert.strictEqual(pool.find(24), first);
  assert.equal(first.allocate(4, 24).offset, 0);
  pool.updated(first);
  assert.strictEqual(pool.find(32), first);
  assert.equal(first.allocate(5, 32).offset, 96);
  pool.updated(first);
  assert.strictEqual(pool.find(40), second);
  assert.equal(second.allocate(4, 40).offset, 0);
  pool.updated(second);
  assert.equal(pool.find(48), null);
});

test('a smaller adequate tail wins over a larger hole in the same arena', () => {
  const arena = new MemoryArena(1, 128);
  arena.allocate(1, 48);
  arena.allocate(2, 48);
  arena.release(1);
  const pool = new ArenaAllocationPool();
  pool.add(arena);
  assert.equal(arena.fitSize(24), 32);
  assert.strictEqual(pool.find(24), arena);
  assert.equal(arena.allocate(3, 24).offset, 96);
  pool.updated(arena);
  assert.strictEqual(pool.find(40), arena);
  assert.equal(arena.allocate(4, 40).offset, 0);
  pool.updated(arena);
  arena.release(4);
  arena.release(2);
  pool.updated(arena);
  assert.equal(pool.holes.size, 1);
  assert.equal(pool.holes.find(88).size, 96);
});

test('thousands of full arenas do not enter allocation candidate trees', () => {
  const pool = new ArenaAllocationPool();
  for (let id = 1; id <= 4096; id++) {
    const arena = new MemoryArena(id, 8);
    pool.add(arena);
    arena.allocate(id, 8);
    pool.updated(arena);
  }
  assert.equal(pool.members.size, 4096);
  assert.equal(pool.holes.size, 0);
  assert.equal(pool.tails.size, 0);
  assert.equal(pool.current, null);
  assert.equal(pool.find(8), null);
  const active = new MemoryArena(4097, 64);
  pool.add(active);
  for (let id = 1; id <= 8; id++) {
    assert.strictEqual(pool.find(8), active);
    active.allocate(id, 8);
    pool.updated(active);
    assert.equal(pool.tails.size, 0);
  }
  assert.equal(pool.find(8), null);
});

test('compaction, removal and restore refresh both hole and tail candidates', () => {
  const pool = new ArenaAllocationPool();
  const arena = new SlotArena(1, 128);
  for (let id = 1; id <= 4; id++) arena.allocate(id, 24);
  arena.release(1);
  arena.release(3);
  pool.add(arena);
  assert.equal(pool.holes.size, 2);
  const snapshot = arena.snapshot();
  applyCompactionPlan(arena, createCompactionPlan(arena, () => false));
  pool.updated(arena);
  assert.equal(pool.holes.size, 0);
  assert.strictEqual(pool.find(80), arena);
  pool.remove(arena);
  assert.equal(pool.find(8), null);
  const restored = SlotArena.restore(snapshot);
  pool.add(restored);
  assert.equal(pool.holes.size, 2);
  assert.equal(pool.find(80), null);
  assert.strictEqual(pool.find(24), restored);
  assert.equal(restored.allocate(5, 24).offset, 0);
  pool.updated(restored);
  assert.equal(pool.holes.size, 1);
});

function referenceArena(arenas, bytes) {
  let best = null;
  let smallest = Infinity;
  for (const arena of arenas.values()) {
    const candidates = [...arena.free.starts.values()].map(block => block.size);
    candidates.push(arena.capacity - arena.highWater);
    const fit = Math.min(...candidates.filter(size => size >= bytes));
    if (fit < smallest || fit === smallest && best && arena.id < best.id) {
      best = arena;
      smallest = fit;
    }
  }
  return best;
}

test('indexed allocation agrees with an exhaustive best-fit oracle through fragmentation churn', () => {
  const pool = new ArenaAllocationPool();
  const arenas = new Map();
  const allocations = [];
  let nextArena = 1;
  for (let step = 1; step <= 1200; step++) {
    const bytes = 8 * (1 + step * 13 % 19);
    let arena = pool.find(bytes);
    assert.strictEqual(arena, referenceArena(arenas, bytes));
    if (!arena) {
      arena = new MemoryArena(nextArena++, 256);
      arenas.set(arena.id, arena);
      pool.add(arena);
    }
    const block = arena.allocate(step, bytes);
    pool.updated(arena);
    allocations.push({arena, block});
    if (step % 3 === 0) {
      const released = allocations[(step * 17) % allocations.length];
      if (!released.block.released) {
        released.arena.release(released.block.id);
        if (released.arena.blocks.size) pool.updated(released.arena);
        else {
          pool.remove(released.arena);
          arenas.delete(released.arena.id);
        }
      }
    }
  }
});
