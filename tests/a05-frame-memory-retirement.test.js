import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {createArray} from '../packages/runtime/src/execution/arrays.js';
import {stackAllocate, stackRegion} from '../packages/runtime/src/execution/stack-memory.js';
import {storePinnedLocal} from '../packages/runtime/src/execution/pinned.js';
import {popPooledFrame} from '../packages/runtime/src/execution/frame-retirement.js';
import {flushFramePool} from '../packages/runtime/src/execution/frame-pool.js';

let compiled;
function make(engine) {
  compiled ??= compileToIL('class Program { static void Worker() {} static int Main() { Worker(); return 7; } }');
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return engine === 'cil' ? new CilVirtualMachine(compiled.assembly) : new VirtualMachine(compiled.image);
}

function scopedMemory(vm) {
  const frame = vm.top;
  const pointer = stackAllocate(vm, 16), reference = createArray(vm, 'int', [2]);
  frame.locals[0] = storePinnedLocal(vm, frame, 0, reference);
  const lease = frame.pinLeases.get(0);
  assert.equal(lease.active, true);
  return {pointer, reference, lease, regions: frame.stackRegions, pins: frame.pinLeases};
}

function released(vm, memory) {
  assert.equal(memory.regions.size, 0);
  assert.equal(memory.pins.size, 0);
  assert.equal(memory.lease.active, false);
  assert.equal(vm.heap.getHandle(memory.lease.handle), null);
  assert.throws(() => stackRegion(vm, memory.pointer), {name: 'InvalidProgramException'});
}

function workerDelegate(vm) {
  const method = vm.inspector
    ? [...vm.inspector.methods.values()].find(item => item.name === 'Worker').token
    : vm.image.methods.find(item => item.name === 'Worker').id;
  return vm.platform.make('System.Action', {method, receiver: null, mode: 'static'}, 'delegate');
}

for (const engine of ['source', 'cil']) {
  for (const restored of [false, true]) {
    test(`${engine}: ${restored ? 'restored' : 'pooled'} frames release regions and pins on actual return`, () => {
      const vm = make(engine);
      try {
        if (restored) vm.restore(vm.snapshot());
        const memory = scopedMemory(vm);
        assert.equal(vm.heap.stats.hostStrongHandles, 1);
        vm.state = 'running';
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.message);
        assert.equal(vm.returnValue, 7);
        released(vm, memory);
        assert.equal(vm.heap.stats.hostStrongHandles, 0);
        vm.heap.collect();
        assert.throws(() => vm.heap.get(memory.reference), {name: 'InvalidReferenceException'});
      } finally { vm.stop(); }
    });
  }

  test(`${engine}: logical retirement revokes capabilities before pool storage is cleared`, () => {
    const vm = make(engine), frame = vm.top, id = frame.id, memory = scopedMemory(vm);
    try {
      popPooledFrame(vm);
      assert.equal(frame.id, id);
      released(vm, memory);
      assert.equal(vm.heap.stats.hostStrongHandles, 0);
      vm.heap.collect();
      assert.doesNotThrow(() => vm.heap.get(memory.reference), 'return callbacks may still read retired locals');
      flushFramePool(vm);
      vm.heap.collect();
      assert.throws(() => vm.heap.get(memory.reference), {name: 'InvalidReferenceException'});
    } finally { vm.stop(); }
  });

  test(`${engine}: cancellation releases parked pins and stop releases the inspectable fatal frame`, () => {
    const vm = make(engine), parent = scopedMemory(vm);
    try {
      const id = vm.scheduler.enqueue(workerDelegate(vm));
      vm.scheduler.load(vm.scheduler.contexts.get(id));
      const child = scopedMemory(vm);
      assert.equal(vm.heap.stats.hostStrongHandles, 2);
      vm.fault = new ManagedFault('ExecutionLimitException', 'fatal active context');
      vm.state = 'faulted';
      vm.scheduler.cancelAll();
      released(vm, parent);
      assert.equal(child.regions.size, 1);
      assert.equal(child.lease.active, true);
      assert.equal(vm.heap.stats.hostStrongHandles, 1);
      vm.stop();
      released(vm, child);
      assert.equal(vm.heap.stats.hostStrongHandles, 0);
      vm.stop();
      assert.equal(vm.heap.stats.hostStrongHandles, 0, 'repeated disposal never decrements another owner');
    } finally { vm.stop(); }
  });

  test(`${engine}: failed provisional admission releases child pins and preserves parent capabilities`, () => {
    const vm = make(engine), parent = scopedMemory(vm), frame = vm.top;
    const call = vm.call, failure = new Error('host failure after provisional admission');
    let child;
    vm.call = function (...args) {
      call.apply(this, args);
      child = scopedMemory(vm);
      throw failure;
    };
    try {
      assert.throws(() => vm.scheduler.enqueue(workerDelegate(vm)), error => error === failure);
      assert.equal(vm.top, frame);
      released(vm, child);
      assert.equal(parent.regions.size, 1);
      assert.equal(parent.lease.active, true);
      assert.equal(vm.heap.stats.hostStrongHandles, 1);
    } finally { delete vm.call; vm.stop(); }
    released(vm, parent);
    assert.equal(vm.heap.stats.hostStrongHandles, 0);
  });
}
