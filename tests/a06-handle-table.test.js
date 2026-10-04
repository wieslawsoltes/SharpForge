import test from 'node:test';
import assert from 'node:assert/strict';
import {HandleTable, ManagedHeap} from '@sharpforge/runtime';

test('A06 identities: ten million allocation/free operations reuse one slot without global identity exhaustion', () => {
  const state = {records: [], generations: [], free: [], generationCounter: 0};
  const table = new HandleTable(state);
  const record = {kind: 'object'};
  const original = table.allocate(record);
  table.release(original.h);
  let current;
  for (let index = 0; index < 10_000_000; index++) {
    current = table.allocate(record);
    table.release(current.h);
  }
  assert.equal(state.records.length, 1);
  assert.equal(current.h, original.h);
  assert.equal(current.g, 10_000_001);
  assert.throws(() => table.get(original), {name: 'InvalidReferenceException'});
});

test('A06 identities: a slot is permanently retired when its own generation reaches the limit', () => {
  const state = {records: [], generations: [], free: [], generationCounter: 0};
  const table = new HandleTable(state, {maxIdentity: 2});
  const first = table.allocate({});
  table.release(first.h);
  const second = table.allocate({});
  table.release(second.h);
  const third = table.allocate({});
  assert.deepEqual(first, {h: 0, g: 1});
  assert.deepEqual(second, {h: 0, g: 2});
  assert.deepEqual(third, {h: 1, g: 1});
  assert.equal(table.retired.has(0), true);
});

test('A06 identities: rewinding never aliases a reference allocated in the discarded future', () => {
  const heap = new ManagedHeap({gcStress: false});
  const saved = heap.snapshot();
  const discarded = heap.object('Future', []);
  heap.restore(saved);
  const current = heap.object('Current', []);
  assert.notDeepEqual(current, discarded);
  assert.throws(() => heap.get(discarded), {name: 'InvalidReferenceException'});
  assert.equal(heap.verify().valid, true);
});

test('A06 identities: malformed table snapshots are rejected before any state changes', () => {
  const state = {records: [], generations: [], free: [], generationCounter: 0};
  const table = new HandleTable(state);
  table.allocate({});
  const before = table.snapshot();
  assert.throws(() => table.restore({...before, highWater: [100], retired: [-1]}), TypeError);
  assert.deepEqual(table.snapshot(), before);
});
