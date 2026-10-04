import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';

function create(route, artifact, options = {}) {
  return route === 'cil' ? new CilVirtualMachine(artifact.assembly, options) :
    new VirtualMachine(route === 'source' ? artifact.image : loadAssembly(artifact.assembly), options);
}

for (const route of ['source', 'reload', 'cil']) {
  test(`T04 ${route}: first-chance debugger pause precedes allocation and replay materializes once`, () => {
    const artifact = compileToIL('int zero=0; try { Console.WriteLine(1/zero); } catch(Exception) { Console.WriteLine("caught"); }');
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    const vm = create(route, artifact, {runtimeEvents: true});
    const before = vm.heap.stats.allocations;
    vm.onException = fault => {
      assert.equal(fault.reference, null);
      assert.equal(vm.heap.stats.allocations, before);
      return true;
    };
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity});
    assert.equal(vm.state, 'paused');
    assert.equal(vm.pendingFault.reference, null);
    const snapshot = vm.snapshot();
    vm.onException = null;
    vm.state = 'running';
    assert.equal(vm.run().output, 'caught\n');
    vm.restore(snapshot);
    vm.state = 'running';
    const replay = vm.run();
    assert.equal(replay.state, 'terminated', replay.fault?.stack);
    assert.equal(replay.output, 'caught\n');
    assert.equal(vm.runtimeEvents.read().filter(event => event.name === 'ExceptionThrown').length, 1);
    vm.stop();
  });

  test(`T04 ${route}: failed OOM materialization retains the original fault and throwing frames`, () => {
    const artifact = compileToIL('Console.WriteLine(42);');
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    const vm = create(route, artifact);
    const frames = [...vm.frames], fault = new ManagedFault('OutOfMemoryException', 'original allocation failure');
    vm.heap.string = () => { throw new Error('secondary string allocation'); };
    if (route === 'cil') vm.raise(fault);
    else vm.handleFault(fault);
    assert.equal(vm.state, 'faulted');
    assert.equal(vm.fault, fault);
    assert.equal(fault.fatal, true);
    assert.equal(fault.reference, null);
    assert.equal(fault.frames.length, frames.length);
    assert.deepEqual(vm.frames, frames);
    vm.stop();
  });
}
