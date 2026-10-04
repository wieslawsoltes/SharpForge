import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {frameById, rebuildFrameIndex} from '../packages/runtime/src/execution/frame-lifetimes.js';
import {createManagedAddress, dereferenceManagedAddress} from '../packages/runtime/src/execution/managed-address.js';
import {sourceAddress, sourceDereference} from '../packages/runtime/src/execution/source-addresses.js';
import {retainCallbackFrames} from '../packages/runtime/src/execution/callback-frames.js';

function program() {
  const result = compileToIL(`using System;
    class Value { public override string ToString() { Console.WriteLine("callback"); return "returned"; } }
    class Program { static void Main() { object retained = null; Console.WriteLine(retained); } }`);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

function stringify(vm, receiver) {
  return vm.platform.bclHost.invokeObjectToString(vm.platform, receiver);
}

for (const engine of ['source', 'cil']) for (const preciseRoots of [false, true]) {
  test(`callback frame index ${engine}, precise=${preciseRoots}: nested callbacks keep parent addresses and GC roots`, () => {
    const compiled = program(), options = {preciseRoots, preciseRootLiveness: true};
    const vm = engine === 'source' ? new VirtualMachine(compiled.image, options)
      : new CilVirtualMachine(compiled.assembly, options);
    const method = frame => vm.inspector ? frame.method : compiled.image.methods[frame.methodId];
    for (let steps = 0; method(vm.top).name !== 'Main' && steps < 100; steps++) {
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    }
    const parent = vm.top, parentId = parent.id;
    assert.equal(method(parent).name, 'Main');
    const slot = vm.inspector ? parent.method.locals.findIndex(type => type === 'object' || type === 'System.Object')
      : method(parent).locals.findIndex(local => local.name === 'retained');
    assert(slot >= 0);
    const address = vm.inspector ? createManagedAddress(vm, 'local', slot) : sourceAddress(vm, 'local', slot);
    const dereference = vm.inspector ? dereferenceManagedAddress : sourceDereference;
    const original = vm.heap.string('original');
    dereference(vm, address, true, original);
    const receiver = vm.heap.object(vm.inspector ? vm.typeSystem.table('Value') : vm.heap.methodTables.get('Value'), []);
    const callbackIds = new Set();
    let callbacks = 0, replacement;
    vm.state = 'paused';
    vm.onOutput = () => {
      callbacks++;
      for (const frame of vm.frames) callbackIds.add(frame.id);
      rebuildFrameIndex(vm);
      assert.equal(frameById(vm, parentId), parent);
      vm.heap.collect();
      assert.equal(vm.value(dereference(vm, address)), callbacks === 1 ? 'original' : 'replacement');
      if (callbacks === 1) {
        replacement = vm.heap.string('replacement');
        dereference(vm, address, true, replacement);
        assert.equal(vm.value(stringify(vm, receiver).value), 'returned');
      }
      vm.heap.collect();
      assert.equal(dereference(vm, address), replacement);
    };
    try {
      assert.equal(vm.value(stringify(vm, receiver).value), 'returned');
      assert.equal(callbacks, 2);
      assert.equal(vm.top, parent);
      assert.equal(vm.scheduler.callbackScopes.length, 0);
      assert.equal(frameById(vm, parentId), parent);
      assert.equal(dereference(vm, address), replacement);
      assert.throws(() => vm.heap.get(original), {name: 'InvalidReferenceException'});
      for (const id of callbackIds) assert.throws(() => frameById(vm, id), /outlived its frame/);
      vm.stop();
      assert.throws(() => dereference(vm, address), /outlived its frame/);
    } finally { vm.stop(); }
  });
}

test('callback frame index retains disabled-scheduler storage and drops released scope membership', () => {
  const frame = {id: 1}, frames = [frame], vm = {frames};
  const scheduler = vm.scheduler = {vm, enabled: false, contexts: new Map()};
  rebuildFrameIndex(vm);
  const lease = retainCallbackFrames(scheduler, {frames});
  assert.throws(() => retainCallbackFrames(scheduler, {frames}), /Duplicate live callback frame scope/);
  assert.equal(scheduler.callbackScopes.length, 1);
  vm.frames = [];
  assert.equal(frameById(vm, 1), frame);
  rebuildFrameIndex(vm);
  assert.equal(frameById(vm, 1), frame);
  lease.release();
  assert.throws(() => frameById(vm, 1), /outlived its frame/);
  assert.equal(scheduler.callbackScopes.length, 0);
});
