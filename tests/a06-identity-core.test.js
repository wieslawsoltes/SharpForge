import test from 'node:test';
import assert from 'node:assert/strict';
import {HandleTable} from '@sharpforge/runtime';
import {ManagedFault} from '../packages/runtime/src/gc/fault.js';
import {isReference, rootReference, sameReference} from '../packages/runtime/src/gc/reference.js';
import {accountAllocation, createStats} from '../packages/runtime/src/gc/stats.js';

function createTable(options) {
  const state = {records: [], generations: [], free: [], generationCounter: 0};
  return {state, table: new HandleTable(state, options)};
}

test('A06 identity core: allocated identities are immutable and stale slots never alias', () => {
  const {table} = createTable();
  const originalRecord = {kind: 'object', data: []};
  const original = table.allocate(originalRecord);
  assert.equal(Object.isFrozen(original), true);
  assert.equal(table.get(original), originalRecord);
  assert.equal(sameReference(original, {...original}), true);
  assert.equal(table.release(original.h), true);
  assert.equal(table.release(original.h), false);
  const replacementRecord = {kind: 'object', data: [42]};
  const replacement = table.allocate(replacementRecord);
  assert.equal(replacement.h, original.h);
  assert.equal(replacement.g, original.g + 1);
  assert.equal(sameReference(original, replacement), false);
  assert.equal(table.get(replacement), replacementRecord);
  assert.equal(table.tryGet(original), null);
  assert.throws(() => table.get(original), {name: 'InvalidReferenceException'});
  assert.throws(() => table.get(null), {name: 'NullReferenceException'});
});

test('A06 identity core: malformed identities and bounded root-owner cycles are rejected', () => {
  for (const value of [null, {}, {h: -1, g: 1}, {h: 0, g: 0}, {h: 0.5, g: 1}, {h: 0, g: Infinity}]) {
    assert.equal(isReference(value), false);
  }
  const {table} = createTable();
  const reference = table.allocate({kind: 'object', data: []});
  const fault = new ManagedFault('ExampleException', 'Managed failure', reference);
  assert.equal(rootReference({byref: true, owner: fault}), reference);
  const cycle = {byref: true};
  cycle.owner = cycle;
  assert.equal(rootReference(cycle), null);
});

test('A06 identity core: overflow retires one slot without exhausting the whole table', () => {
  const {table, state} = createTable({maxIdentity: 3});
  for (let generation = 1; generation <= 3; generation++) {
    const reference = table.allocate({kind: 'object', data: []});
    assert.deepEqual(reference, {h: 0, g: generation});
    assert.equal(table.release(reference.h), true);
  }
  assert.equal(table.retired.has(0), true);
  assert.deepEqual(table.allocate({kind: 'object', data: []}), {h: 1, g: 1});
  assert.equal(state.generationCounter, 4);
  assert.throws(() => createTable({maxIdentity: 0}), RangeError);
});

test('A06 identity core: restoring records preserves future identity high-water marks', () => {
  const {table, state} = createTable();
  const retained = table.allocate({kind: 'object', data: ['retained']});
  const saved = {
    identity: table.snapshot(), records: [...state.records],
    generations: [...state.generations], free: [...state.free]
  };
  const future = table.allocate({kind: 'object', data: ['future']});
  // The owner restores record contents first; HandleTable restores identity bookkeeping afterward.
  state.records = [...saved.records];
  state.generations = [...saved.generations];
  state.free = [...saved.free];
  table.restore(saved.identity);
  const current = table.allocate({kind: 'object', data: ['current']});
  assert.equal(current.h, future.h);
  assert.equal(current.g, future.g + 1);
  assert.equal(table.get(retained), saved.records[retained.h]);
  assert.throws(() => table.get(future), {name: 'InvalidReferenceException'});
  assert.equal(state.records.length, 2);
});

test('A06 identity core: malformed snapshots fail before mutating identity state', () => {
  const {table} = createTable({maxIdentity: 4});
  table.allocate({kind: 'object', data: []});
  const before = table.snapshot();
  for (const invalid of [
    {...before, version: 2}, {...before, maxIdentity: 5},
    {...before, highWater: [5]}, {...before, retired: [-1]}
  ]) {
    assert.throws(() => table.restore(invalid), TypeError);
    assert.deepEqual(table.snapshot(), before);
  }
});

test('A06 identity core: allocation totals retain exact bytes beyond Number precision', () => {
  const owner = {allocatedBytes64: 9_007_199_254_740_993n};
  const restored = {generationCounts: [1, 2, 3]};
  owner.stats = createStats(owner, restored);
  accountAllocation(owner, 24);
  assert.equal(owner.stats.allocatedBytes64, 9_007_199_254_741_017n);
  assert.equal(owner.stats.allocatedBytes, 24);
  assert.equal(owner.stats.liveBytes, 24);
  assert.equal(owner.stats.liveObjects, 1);
  assert.equal(owner.stats.peakBytes, 24);
  owner.stats.generationCounts[0] = 9;
  assert.deepEqual(restored.generationCounts, [1, 2, 3]);
});
