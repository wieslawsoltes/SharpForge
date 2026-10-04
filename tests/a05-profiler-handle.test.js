import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, instructionProfile} from '@sharpforge/runtime';

const source = 'class Program { static void Main() { int value = 4; Console.WriteLine(value + 3); } }';

function input(engine) {
  const compiled = compileToIL(source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return engine === 'source' ? compiled.image : compiled.assembly;
}

for (const engine of ['source', 'reload', 'cil']) {
  const BaseVM = engine === 'cil' ? CilVirtualMachine : VirtualMachine;

  test(`${engine}: the profiler handle is available to the initial entry call and subclass getter`, () => {
    const entries = [];
    let reads = 0;
    class ObservedVM extends BaseVM {
      get profiler() {
        reads++;
        return super.profiler;
      }
      call(...args) {
        entries.push(this.profiler);
        return super.call(...args);
      }
    }
    const vm = new ObservedVM(input(engine), {profile: true});
    try {
      const handle = vm.profiler;
      assert(handle);
      assert.equal(entries.length, 1);
      assert.equal(entries[0], handle);
      assert.equal(instructionProfile(vm).methods.reduce((total, method) => total + method.calls, 0), 1);
      const initialReads = reads;
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '7\n');
      assert(reads > initialReads, 'Execution still observes an overriding public getter');
      assert.equal(instructionProfile(vm).instructions, vm.instructions);
      assert.equal(Object.hasOwn(vm, 'profiler'), false);
    } finally {
      vm.stop();
    }
  });

  test(`${engine}: an own getter remains observable without replacing the host profiler`, () => {
    const vm = new BaseVM(input(engine), {profile: true});
    try {
      const handle = vm.profiler;
      let reads = 0;
      Object.defineProperty(vm, 'profiler', {configurable: true, get() { reads++; return null; }});
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
      assert(reads > 0);
      assert.equal(vm.instructions, 1);
      assert.equal(instructionProfile(vm).instructions, 0, 'The host API retains its own observer despite getter override');
      delete vm.profiler;
      assert.equal(vm.profiler, handle);
      vm.options.profile = false;
      const snapshot = vm.snapshot();
      assert.equal(vm.run().output, '7\n');
      assert(instructionProfile(vm).instructions > 0, 'Construction fixes whether profiling is enabled');
      const beforeRestore = instructionProfile(vm);
      vm.restore(snapshot);
      assert.equal(vm.profiler, handle);
      assert.deepEqual(instructionProfile(vm), beforeRestore);
      assert.equal(vm.run().output, '7\n');
    } finally {
      vm.stop();
    }
  });

  test(`${engine}: changing options cannot create an observer after disabled construction`, () => {
    const vm = new BaseVM(input(engine), {profile: false});
    try {
      vm.options.profile = true;
      assert.equal(vm.profiler, null);
      assert.equal(vm.run().output, '7\n');
      assert.equal(instructionProfile(vm), null);
    } finally {
      vm.stop();
    }
  });
}
