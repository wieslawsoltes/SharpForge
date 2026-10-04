import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';

const compiled = compileToIL('using System;class Program {static void Main(){'
  + 'int[] first=new int[256];int[] second=new int[256];Array.Copy(first,second,256);'
  + 'Array.Clear(first,0,256);Console.WriteLine(second[0]);Console.WriteLine(second[255]);}}');
assert(compiled.success, JSON.stringify(compiled.diagnostics));
const create = engine => engine === 'cil' ? new CilVirtualMachine(compiled.assembly) : new VirtualMachine(compiled.image);

function reach(vm, operation) {
  for (let step = 0; step < 200 && vm.top?.intrinsicContinuation?.operation !== operation; step++) {
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    if (['terminated', 'faulted'].includes(vm.state)) break;
  }
  assert.equal(vm.top?.intrinsicContinuation?.operation, operation, vm.fault?.message);
  return vm.top.intrinsicContinuation;
}

for (const engine of ['source', 'cil']) {
  test(`${engine}: portable partial Copy and Clear replay their captured owners after cancellation and collection`, async () => {
    const vm = create(engine), copy = reach(vm, 'Copy');
    const data = vm.heap.get(copy.source).data;
    data[0] = 17;
    data[255] = 43;
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    assert(copy.index > 0 && copy.index < copy.length);
    const copying = vm.snapshot(), liveFrames = vm.frames, liveRecords = vm.heap.records;
    copying.frames.at(-1).intrinsicContinuation.index = copy.length + 1;
    assert.throws(() => vm.restore(copying), /array continuation/);
    assert.equal(vm.frames, liveFrames);
    assert.equal(vm.heap.records, liveRecords);
    const savedCopy = vm.snapshot();
    const clearing = reach(vm, 'Clear');
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    assert(clearing.index > 0 && clearing.index < clearing.length);
    const savedClear = vm.snapshot();
    const wires = [await serializeSnapshot(vm, savedCopy, {json: true}), await serializeSnapshot(vm, savedClear)];
    vm.stop();
    vm.heap.collect();
    for (const wire of wires) {
      const fresh = create(engine);
      await restoreSerializedSnapshot(fresh, wire);
      const result = fresh.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '17\n43\n');
      fresh.stop();
    }
  });
}
