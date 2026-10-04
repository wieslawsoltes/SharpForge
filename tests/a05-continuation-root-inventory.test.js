import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';

const compiled = compileToIL('Console.WriteLine(7);');
assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));

for (const engine of ['source', 'cil']) {
  test(`${engine}: filter, event, delegate and managed-array continuations expose every owner`, () => {
    const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly) : new VirtualMachine(compiled.image);
    const references = Array.from({length: 12}, () => vm.heap.object('object', []));
    const frame = vm.top;
    frame.asyncBuilderTask = references[0];
    frame.filterSearch = {error: new ManagedFault('Exception', 'filter', references[1])};
    frame.exceptionEventContinuation = {fault: new ManagedFault('Exception', 'event', references[2]),
      handlers: [references[3]], args: [references[4]]};
    frame.delegateContinuation = {entries: [references[5]], args: [references[6]]};
    frame.intrinsicContinuation = {reference: references[7], source: {byref: true, owner: references[8]},
      destination: references[9], value: references[10], resultAddress: {byref: true, owner: references[11]}};
    try {
      vm.heap.collect();
      for (const reference of references) assert.doesNotThrow(() => vm.heap.get(reference));
      frame.asyncBuilderTask = frame.filterSearch = frame.exceptionEventContinuation = null;
      frame.delegateContinuation = frame.intrinsicContinuation = null;
      vm.heap.collect();
      for (const reference of references) assert.throws(() => vm.heap.get(reference), {name: 'InvalidReferenceException'});
    } finally { vm.stop(); }
  });

  test(`${engine}: scheduler async state, unhandled delivery and synchronization roots remain reachable`, () => {
    const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly) : new VirtualMachine(compiled.image);
    const references = Array.from({length: 6}, () => vm.heap.object('object', []));
    vm.scheduler.ensure();
    vm.scheduler.tasks.set(123, {id: 123, status: 'waiting', ref: references[0],
      asyncState: {machine: references[1], awaitedTask: references[2]}});
    vm.scheduler.unhandledFault = new ManagedFault('Exception', 'unhandled', references[3]);
    vm.sync = {roots: function* () { yield references[4]; yield {byref: true, owner: references[5]}; }};
    try {
      vm.heap.collect();
      for (const reference of references) assert.doesNotThrow(() => vm.heap.get(reference));
      vm.scheduler.tasks.clear();
      vm.scheduler.unhandledFault = null;
      delete vm.sync;
      vm.heap.collect();
      for (const reference of references) assert.throws(() => vm.heap.get(reference), {name: 'InvalidReferenceException'});
    } finally { vm.scheduler.tasks.clear(); delete vm.sync; vm.stop(); }
  });
}
