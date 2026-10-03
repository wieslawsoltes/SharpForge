import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';

function engines(source) {
  const compiled = compileToIL(source);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  return [
    ['source', () => new VirtualMachine(compiled.image, {virtualTime: true})],
    ['cil', () => new CilVirtualMachine(compiled.assembly, {virtualTime: true})]
  ];
}

const cleanup = 'class P { static void Log(){Console.WriteLine("cleanup");} '
  + 'static void F(){try{throw new Exception("saved");}finally{Log();}} '
  + 'static void Main(){try{F();}catch(Exception e){Console.WriteLine(e.Message);}} }';
for (const engine of ['source', 'cil']) {
  test(`T06 ${engine}: portable replay preserves a pending first-chance fault and nested finally calls`, async () => {
    const create = engines(cleanup).find(([name]) => name === engine)[1];
    const vm = create();
    vm.onException = () => true;
    vm.run();
    assert.equal(vm.state, 'paused');
    assert(vm.pendingFault);
    const pending = await serializeSnapshot(vm);
    vm.onException = null;
    vm.state = 'running';
    const inFinally = [];
    while (vm.state === 'running') {
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
      if (vm.frames.length > 2 && vm.frames.some(frame => frame.unwinds?.length || frame.pending)) {
        inFinally.push(await serializeSnapshot(vm));
      }
    }
    assert.equal(vm.state, 'terminated', vm.fault?.stack);
    const expected = vm.output.join('');
    assert.equal(expected, 'cleanup\nsaved\n');
    assert(inFinally.length > 0, 'Observe a nested call while finally owns an unwind');
    for (const wire of [pending, ...inFinally]) {
      const fresh = create();
      await restoreSerializedSnapshot(fresh, structuredClone(wire));
      fresh.state = 'running';
      assert.equal(fresh.run().output, expected);
      assert.equal(fresh.state, 'terminated', fresh.fault?.stack);
    }
  });

  test(`T06 ${engine}: portable awaiting contexts replay after original cancellation and collection`, async () => {
    const source = 'using System.Threading.Tasks;class P {static void Cleanup(){Console.WriteLine("finally");}'
      + 'static async Task Main(){try{Console.WriteLine("start");await Task.Delay(10);'
      + 'Console.WriteLine("after");}finally{Cleanup();}}}';
    const create = engines(source).find(([name]) => name === engine)[1];
    const vm = create();
    vm.run();
    assert.equal(vm.state, 'waiting');
    const wire = await serializeSnapshot(vm, vm.snapshot(), {json: true});
    vm.stop();
    vm.heap.collect();
    for (let replay = 0; replay < 2; replay++) {
      const fresh = create();
      await restoreSerializedSnapshot(fresh, wire);
      if (fresh.state === 'paused') fresh.state = 'running';
      const result = await fresh.runAsync();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'start\nafter\nfinally\n');
    }
  });
}
