import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '../packages/compiler/src/index.js';
import { VirtualMachine, CilVirtualMachine } from '../packages/runtime/src/index.js';
const source = `using System; using System.Threading.Tasks;
class Program {
 static async Task Work() { await Task.Delay(1); throw new Exception("await-fault"); }
 static async Task Main() { try { await Work(); } catch (Exception e) { Console.WriteLine(e.Message); } finally { Console.WriteLine("await-finally"); } }
}`;
for (const [engine, VM] of [['source', VirtualMachine], ['cil', CilVirtualMachine]]) {
  test(`${engine} roots a resumed async exception through forced collection before dispatch`, async () => {
    const compilation = compileToIL(source); assert(compilation.success, JSON.stringify(compilation.diagnostics));
    const vm = new VM(engine === 'source' ? compilation.image : compilation.assembly, { virtualTime: true, initialThreshold: 64 });
    const reserve = vm.heap.reserve.bind(vm.heap);
    vm.heap.reserve = (bytes, roots = []) => { const pinned = [...roots]; vm.heap.collect(pinned); return reserve(bytes, pinned); };
    let slices = 0, observedResume = false;
    try {
      while (!['terminated', 'faulted'].includes(vm.state)) {
        assert(++slices < 20000, 'fixture terminated within its instruction budget');
        vm.heap.collect(); vm.runSlice({ instructionBudget: 1, timeBudgetMs: 100 }); vm.heap.collect();
        if (vm.scheduler.current?.resumeFault?.reference) observedResume = true;
        if (vm.state === 'waiting') vm.scheduler.advance(10);
        await Promise.resolve();
      }
      assert.equal(vm.state, 'terminated', vm.fault?.message);
      assert.equal(vm.output.join(''), 'await-fault\nawait-finally\n');
      assert(vm.heap.stats.collections > 10);
      if (engine === 'cil') assert(observedResume, 'forced collections crossed a resumed fault boundary');
    } finally { vm.heap.reserve = reserve; vm.stop(); }
  });
}
