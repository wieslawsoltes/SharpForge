import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';

const sleeping = compileToIL('using System.Threading; class Program {'
  + 'static void Main(){ Console.Write("before:");Thread.Sleep(10);Console.WriteLine("after"); }}');
const looping = compileToIL('int n=0;while(n<1000){n=n+1;}Console.WriteLine(n);');
assert(sleeping.success, JSON.stringify(sleeping.diagnostics));
assert(looping.success, JSON.stringify(looping.diagnostics));
const create = (engine, artifact, options = {}) => engine === 'source'
  ? new VirtualMachine(artifact.image, {virtualTime: true, ...options})
  : new CilVirtualMachine(artifact.assembly, {virtualTime: true, ...options});

for (const engine of ['source', 'cil']) {
  test(`${engine}: parked capture restores coherent waits after cancellation and live collection`, async () => {
    const vm = create(engine, sleeping);
    assert.equal(vm.run().state, 'waiting', vm.fault?.message);
    assert.equal(vm.frames.length, 0);
    const saved = vm.snapshot(), wire = await serializeSnapshot(vm, saved, {json: true});
    const parked = new Map(saved.scheduler.contexts).get(saved.scheduler.currentId);
    assert(parked.frames.length > 0);
    vm.scheduler.cancelAll();
    vm.heap.collect();
    vm.restore(saved);
    assert.equal(vm.state, 'waiting');
    vm.scheduler.advance(10);
    assert.equal(vm.run().output, 'before:after\n');
    vm.stop();
    for (let replay = 0; replay < 2; replay++) {
      const fresh = create(engine, sleeping);
      await restoreSerializedSnapshot(fresh, wire);
      assert.equal(fresh.state, 'waiting');
      const actual = await fresh.runAsync();
      assert.equal(actual.state, 'terminated', actual.fault?.message);
      assert.equal(actual.output, 'before:after\n');
      fresh.stop();
    }
  });

  test(`${engine}: terminal current contexts never reacquire retained fatal active frames`, async () => {
    const vm = create(engine, looping, {maxInstructions: 256});
    vm.scheduler.ensure();
    assert.equal(vm.run().state, 'faulted');
    assert(vm.frames.length > 0);
    vm.scheduler.cancelAll();
    assert.equal(vm.scheduler.current.status, 'canceled');
    assert.equal(vm.scheduler.current.frames.length, 0);
    const saved = vm.snapshot();
    assert(saved.frames.length > 0);
    assert.equal(new Map(saved.scheduler.contexts).get(saved.scheduler.currentId).frames.length, 0);
    assert.equal(vm.scheduler.current.frames.length, 0, 'Capture must not resurrect terminal frame ownership');
    const fresh = create(engine, looping, {maxInstructions: 256});
    await restoreSerializedSnapshot(fresh, await serializeSnapshot(vm, saved));
    assert.equal(fresh.state, 'faulted');
    assert.equal(fresh.frames.length, saved.frames.length);
    assert.equal(fresh.scheduler.current.frames.length, 0);
    assert.equal(fresh.run().state, 'faulted');
    assert.equal(fresh.instructions, saved.instructions);
  });
}
