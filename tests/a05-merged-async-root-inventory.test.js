import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {cancelAsyncTask} from '../packages/runtime/src/execution/async-continuation-roots.js';
import {popPooledFrame} from '../packages/runtime/src/execution/frame-retirement.js';
import {flushFramePool} from '../packages/runtime/src/execution/frame-pool.js';

let program;
for (const engine of ['source', 'cil']) for (const preciseRoots of [false, true]) {
  test(`${engine}, precise=${preciseRoots}: async ABI registrations and existing continuations share one root inventory`, () => {
    program ??= compileToIL('class Program { static void Main() {} }');
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    const vm = engine === 'cil' ? new CilVirtualMachine(program.assembly, {preciseRoots})
      : new VirtualMachine(program.image, {preciseRoots});
    const references = Array.from({length: 9}, () => vm.heap.object('object', []));
    const frame = vm.top;
    frame.asyncRegistration = {task: references[0], continuation: {receiver: references[1]}};
    frame.asyncBuilderTask = references[2];
    frame.objectValueWork = {nodes: [{left: references[3]}]};
    const task = {id: 123, status: 'waiting', ref: references[4],
      asyncState: {machine: references[5], awaitedTask: references[6]},
      asyncMachine: {receiver: references[7]}, continuations: [{receiver: references[8]}]};
    vm.scheduler.ensure();
    vm.scheduler.tasks.set(task.id, task);
    try {
      vm.heap.collect();
      for (const reference of references) assert.doesNotThrow(() => vm.heap.get(reference));
      cancelAsyncTask(task);
      vm.heap.collect();
      for (const reference of references.slice(0, 7)) assert.doesNotThrow(() => vm.heap.get(reference));
      for (const reference of references.slice(7)) assert.throws(() => vm.heap.get(reference), {name: 'InvalidReferenceException'});
      vm.scheduler.tasks.clear();
      popPooledFrame(vm);
      vm.heap.collect();
      for (const reference of references.slice(0, 4)) assert.doesNotThrow(() => vm.heap.get(reference),
        'Retired return metadata remains rooted until continuation delivery completes');
      flushFramePool(vm);
      vm.heap.collect();
      for (const reference of references) assert.throws(() => vm.heap.get(reference), {name: 'InvalidReferenceException'});
    } finally { vm.scheduler.tasks.clear(); vm.stop(); }
  });
}
