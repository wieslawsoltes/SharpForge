import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot, executionCodeStatistics} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';
import {createArray, arrayAddress, arrayGet} from '../packages/runtime/src/execution/arrays.js';
import {stackSpan, spanFromArray, spanGet, spanSet} from '../packages/runtime/src/execution/spans.js';
import {pointerOffset, readMemory, writeMemory, reinterpretPointer} from '../packages/runtime/src/execution/raw-memory.js';
import {storePinnedLocal} from '../packages/runtime/src/execution/pinned.js';
import {stackAllocate} from '../packages/runtime/src/execution/stack-memory.js';

const bytes = genericCallFixture([{name: 'Program', methods: [{name: 'Main',
  locals: ['object', 'object', 'object', 'int'], body: writer => writer.op('ret')}]}]);

function populated() {
  const vm = new CilVirtualMachine(bytes);
  vm.scheduler.ensure();
  const span = stackSpan(vm, 'int', 3);
  spanSet(vm, span, 0, 17);
  spanSet(vm, span, 1, 29);
  vm.top.locals[0] = span;
  const array = createArray(vm, 'int', [4]);
  const pin = storePinnedLocal(vm, vm.top, 1, arrayAddress(vm, array, [0]));
  vm.top.locals[1] = pointerOffset(vm, pin, 4, 'int');
  writeMemory(vm, vm.top.locals[1], 43, 'int');
  vm.top.locals[2] = spanFromArray(vm, 'int', array, 4, 0);
  vm.top.locals[3] = 0x3f800000;
  vm.returnValue = reinterpretPointer(vm, vm.address('local', 3), 'int', 'float');
  return {vm, array};
}

function assertMemory(vm) {
  assert.equal(spanGet(vm, vm.top.locals[0], 0), 17);
  assert.equal(spanGet(vm, vm.top.locals[0], 1), 29);
  assert.equal(readMemory(vm, vm.top.locals[1], 'int'), 43);
  assert.equal(vm.top.locals[2].length, 0);
  assert.equal(vm.top.locals[2].pointer.index, 4);
  assert.equal(readMemory(vm, vm.returnValue, 'float').value, 1);
  assert.equal(vm.heap.stats.hostStrongHandles, 1);
}

test('local and portable captures replay frame bytes, scoped pins, empty spans and reinterpretation after collection', async () => {
  const {vm, array} = populated();
  const saved = vm.snapshot(), wire = await serializeSnapshot(vm, saved, {json: true});
  const oldRegions = vm.top.stackRegions, oldLease = vm.top.pinLeases.get(1);
  vm.restore(saved);
  assert.equal(oldRegions.size, 0, 'A committed restore retires the abandoned frame memory');
  assert.equal(oldLease.active, false);
  assertMemory(vm);
  spanSet(vm, vm.top.locals[0], 0, 99);
  writeMemory(vm, vm.top.locals[1], 101, 'int');
  vm.stop();
  vm.returnValue = null;
  vm.heap.collect();
  assert.throws(() => vm.heap.get(array), {name: 'InvalidReferenceException'});
  for (let replay = 0; replay < 2; replay++) {
    vm.restore(saved);
    assertMemory(vm);
    assert.equal(arrayGet(vm, array, [1]), 43);
    vm.run();
    assert.equal(vm.heap.stats.hostStrongHandles, 0);
  }
  for (let replay = 0; replay < 2; replay++) {
    const fresh = new CilVirtualMachine(bytes);
    await restoreSerializedSnapshot(fresh, wire);
    assertMemory(fresh);
    assert.equal(fresh.top.locals[0].vmOwner, fresh.snapshotOwner);
    assert.equal(fresh.top.pinLeases.get(1).handle.owner, fresh.heap.handleOwner);
    fresh.run();
    assert.equal(fresh.heap.stats.hostStrongHandles, 0);
    fresh.stop();
  }
  vm.stop();
});

test('captured memory rejects stale regions, pin handles, wrong types and bounds before retiring live capabilities', () => {
  const {vm, array} = populated(), other = new CilVirtualMachine(bytes);
  const liveFrames = vm.frames, records = vm.heap.records, regions = vm.top.stackRegions;
  const lease = vm.top.pinLeases.get(1), epoch = executionCodeStatistics(vm).epoch;
  const reject = (mutate, match) => {
    const saved = vm.snapshot();
    mutate(saved);
    assert.throws(() => vm.restore(saved), match);
    assert.equal(vm.frames, liveFrames);
    assert.equal(vm.heap.records, records);
    assert.equal(vm.top.stackRegions, regions);
    assert.equal(regions.size, 1);
    assert.equal(lease.active, true);
    assert.equal(executionCodeStatistics(vm).epoch, epoch);
    assertMemory(vm);
  };
  reject(saved => saved.frames[0].stackRegions.clear(), /expired stack region/);
  reject(saved => saved.memorySequence = 0, /memory allocation identity/);
  reject(saved => saved.frames[0].pinLeases.get(1).handle = Object.freeze({...lease.handle, owner: other.heap.handleOwner}), /pin handle/);
  reject(saved => saved.frames[0].pinLeases.get(1).active = false, /pin local/);
  reject(saved => saved.frames[0].locals[1] = Object.freeze({...saved.frames[0].locals[1], leaseId: 0}), /expired pin/);
  reject(saved => saved.frames[0].locals[0] = Object.freeze({...saved.frames[0].locals[0], length: 4}), /Span byte bounds/);
  reject(saved => saved.frames[0].locals[2] = Object.freeze({...saved.frames[0].locals[2], length: 1}), /Span array bounds/);
  reject(saved => saved.returnValue = Object.freeze({...saved.returnValue, sourceType: vm.heap.methodTables.get('long')}), /source type/);
  reject(saved => saved.returnValue = Object.freeze({...saved.returnValue, vmOwner: other.snapshotOwner}), /ownership/);
  reject(saved => {
    const record = saved.heap.records[array.h];
    saved.heap.records[array.h] = {...record, data: new Float32Array(4)};
  }, /array backing element type/);
  reject(saved => {
    const record = saved.heap.records[array.h];
    saved.heap.records[array.h] = {...record, arrayShape: {...record.arrayShape, strides: [2]}};
  }, /array shape/);
  vm.stop();
  other.stop();
});

test('captured stack regions reject overlapping buffers and destination byte quota overruns', async () => {
  const vm = new CilVirtualMachine(bytes), first = stackAllocate(vm, 8), second = stackAllocate(vm, 8);
  vm.top.locals[0] = first;
  vm.top.locals[1] = second;
  const saved = vm.snapshot(), wire = await serializeSnapshot(vm, saved);
  const regions = saved.frames[0].stackRegions;
  regions.get(second.regionId).bytes = regions.get(first.regionId).bytes;
  assert.throws(() => vm.restore(saved), /stack region bytes or alias/);
  const limited = new CilVirtualMachine(bytes, {maxStackMemoryBytes: 8}), records = limited.heap.records;
  await assert.rejects(restoreSerializedSnapshot(limited, wire), /stack memory budget/);
  assert.equal(limited.heap.records, records);
  vm.stop();
  limited.stop();
});
