import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryArena} from '../packages/runtime/src/gc/arena.js';
import {primitiveStorage, writeUtf16, readUtf16} from '../packages/runtime/src/gc/primitive-storage.js';
import {createSpatialArrayView} from '../packages/runtime/src/gc/spatial-array-view.js';
import {createCompactionPlan, applyCompactionPlan} from '../packages/runtime/src/gc/compact-plan.js';

function arrayView(type, length, arena = new MemoryArena(1, 4096), id = 1) {
  const codec = primitiveStorage(type);
  const block = arena.allocate(id, codec.size * length);
  const binding = {arena, block, codec, length, readOnly: false};
  return {view: createSpatialArrayView(binding), binding, arena, block};
}

test('primitive arena views keep Array identity, enumeration, iteration and bulk array semantics', () => {
  const {view, arena, block} = arrayView('System.Int32', 5);
  assert.equal(Array.isArray(view), true);
  view.fill(3);
  view[2] = 17;
  assert.equal(arena.view.getInt32(block.offset + 8, true), 17);
  arena.view.setInt32(block.offset, 11, true);
  assert.equal(view[0], 11, 'the arena is authoritative, not a JS array mirror');
  assert.deepEqual([...view], [11, 3, 17, 3, 3]);
  assert.deepEqual(view.slice(1, 4), [3, 17, 3]);
  assert.deepEqual(view.map(value => value + 1), [12, 4, 18, 4, 4]);
  assert.deepEqual(Object.keys(view), ['0', '1', '2', '3', '4']);
  assert.equal(JSON.stringify(view), '[11,3,17,3,3]');
  view.copyWithin(1, 0, 3);
  assert.deepEqual([...view], [11, 11, 3, 17, 3]);
  view.sort((left, right) => left - right);
  assert.deepEqual([...view], [3, 3, 11, 11, 17]);
});

test('Boolean, 64-bit integer and IEEE floating-point stores retain their CLR representations', () => {
  const booleans = arrayView('System.Boolean', 2).view;
  booleans[1] = true;
  assert.deepEqual([...booleans], [false, true]);
  const signed = arrayView('System.Int64', 2).view;
  signed[0] = -9223372036854775808n;
  signed[1] = 9223372036854775807n;
  assert.deepEqual([...signed], [-9223372036854775808n, 9223372036854775807n]);
  const unsigned = arrayView('System.UInt64', 1).view;
  unsigned[0] = 18446744073709551615n;
  assert.equal(unsigned[0], 18446744073709551615n);
  const floats = arrayView('System.Single', 3).view;
  floats[0] = 1 / 3;
  floats[1] = -0;
  floats[2] = NaN;
  assert.equal(floats[0], Math.fround(1 / 3));
  assert.equal(Object.is(floats[1], -0), true);
  assert.equal(Number.isNaN(floats[2]), true);
  floats[0] = Object.freeze({float: 'r8', value: 0.1});
  assert.equal(floats[0], Math.fround(0.1), 'CIL evaluation-stack floats are normalized at the storage boundary');
});

test('pointer-sized primitive stores follow the descriptor width without truncating safe native values', () => {
  const arena = new MemoryArena(1, 128);
  const block = arena.allocate(1, 16);
  const codec = primitiveStorage('System.IntPtr', 8);
  const view = createSpatialArrayView({arena, block, codec, length: 2, readOnly: false});
  view[0] = 4294967301;
  view[1] = 9223372036854775807n;
  assert.equal(codec.size, 8);
  assert.equal(view[0], 4294967301);
  assert.equal(view[1], 9223372036854775807n);
  assert.equal(arena.view.getBigInt64(block.offset, true), 4294967301n);
});

test('primitive array shape, read-only storage and reclaimed view guards fail explicitly', () => {
  const {view, binding} = arrayView('System.Byte', 1);
  assert.throws(() => { view[1] = 5; }, {name: 'IndexOutOfRangeException'});
  assert.throws(() => view.push(5), {name: 'IndexOutOfRangeException'});
  assert.throws(() => { view.length = 0; }, {name: 'NotSupportedException'});
  assert.throws(() => { delete view[0]; }, {name: 'NotSupportedException'});
  assert.throws(() => { view[0] = {h: 1, g: 2}; }, TypeError);
  binding.readOnly = true;
  assert.throws(() => { view[0] = 5; }, {name: 'InvalidOperationException'});
  binding.block.released = true;
  assert.throws(() => view[0], {name: 'InvalidReferenceException'});
  assert.equal(arrayView('System.Byte', 0).view.length, 0);
});

test('sliding typed arrays recover contiguous space while held views follow the new offset', () => {
  const arena = new MemoryArena(1, 256);
  arena.allocate(1, 32);
  const live = arrayView('System.Int32', 8, arena, 2);
  live.view.fill(19);
  const originalOffset = live.block.offset;
  arena.release(1);
  applyCompactionPlan(arena, createCompactionPlan(arena, () => false));
  assert.ok(live.block.offset < originalOffset);
  assert.deepEqual([...live.view], Array(8).fill(19));
  assert.equal(arena.memoryInfo().fragmentedBytes, 0);
  assert.ok(arena.allocate(3, 200));
});

test('UTF-16 arena storage and snapshots preserve paired and unpaired surrogate code units', () => {
  const arena = new MemoryArena(1, 256);
  arena.allocate(1, 32);
  const text = 'A\ud83d\ude80\ud800\0Z';
  const block = arena.allocate(2, text.length * 2);
  writeUtf16(arena, block, text);
  const saved = arena.snapshot();
  arena.release(1);
  applyCompactionPlan(arena, createCompactionPlan(arena, () => false));
  assert.equal(readUtf16(arena, block, text.length), text);
  const restored = MemoryArena.restore(saved);
  assert.equal(readUtf16(restored, restored.blocks.get(2), text.length), text);
  assert.notStrictEqual(restored.buffer, arena.buffer);
});
