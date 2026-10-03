import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/heap.js';
import {registerFrame, releaseFrame, frameById, rebuildFrameIndex} from '../packages/runtime/src/execution/frame-lifetimes.js';

test('live frame lookup is indexed across active and parked contexts', () => {
  const active = {id: 1};
  const parked = {id: 2};
  const completed = {id: 3};
  const vm = {
    heap: new ManagedHeap(), frames: [active],
    scheduler: {currentId: 1, contexts: new Map([
      [1, {id: 1, status: 'running', frames: [active]}],
      [2, {id: 2, status: 'waiting', frames: [parked]}],
      [3, {id: 3, status: 'completed', frames: [completed]}]
    ])}
  };
  rebuildFrameIndex(vm);
  vm.frames.find = () => { throw new Error('Lookup must not scan frames'); };
  assert.equal(frameById(vm, 1), active);
  assert.equal(frameById(vm, 2), parked);
  assert.throws(() => frameById(vm, 3), {name: 'InvalidProgramException'});
  releaseFrame(vm, parked);
  assert.throws(() => frameById(vm, 2), {name: 'InvalidProgramException'});
});

test('filter exit preserves owner leases; real exit releases pin handles', () => {
  const heap = new ManagedHeap();
  const owner = {id: 1, stackRegions: new Map([[1, new Uint8Array(4)]])};
  const handle = heap.createHandle(heap.string('pinned'));
  owner.pinLeases = new Map([[0, {active: true, handle}]]);
  const filter = {id: 2, filterOwnerId: 1};
  const vm = {heap, frames: [owner, filter]};
  registerFrame(vm, owner);
  registerFrame(vm, filter);
  releaseFrame(vm, filter);
  assert.equal(owner.stackRegions.size, 1);
  assert.notEqual(heap.getHandle(handle), null);
  releaseFrame(vm, owner);
  assert.equal(owner.stackRegions.size, 0);
  assert.equal(heap.getHandle(handle), null);
});
