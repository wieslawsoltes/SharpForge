import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {ManagedFault} from '../packages/runtime/src/execution/managed-fault.js';

const program = methods => `using System; using System.Threading.Tasks;
  delegate int Op(int value); class Program { ${methods} }`;

function factory(source, engine) {
  const result = engine === 'source' ? compile(source) : compileToIL(source, {includeDebug: false});
  assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
  const product = engine === 'source' ? result.image : result.assembly;
  assert.ok(product);
  return () => new (engine === 'source' ? VirtualMachine : CilVirtualMachine)(product, {virtualTime: true});
}

function finish(vm) {
  let result = vm.run();
  for (let attempt = 0; attempt < 100 && result.state === 'waiting'; attempt++) {
    const delay = vm.scheduler.nextDelay();
    assert.notEqual(delay, null, 'A waiting cleanup must have a scheduled wake-up');
    vm.scheduler.advance(delay);
    result = vm.run();
  }
  assert.equal(result.state, 'terminated', result.fault?.stack);
  return result.output;
}

for (const engine of ['source', 'cil']) {
  test(`${engine}: filters precede pending task cleanup, including local and portable replay`, async () => {
    const create = factory(program(`
      static bool Reject() { Console.WriteLine("filter"); return false; }
      static async Task Work() {
        try { throw new Exception("original"); }
        catch (Exception error) when (Reject()) { Console.WriteLine("unreachable"); }
        finally { Console.WriteLine("enter"); await Task.Delay(7); Console.WriteLine("leave"); }
      }
      static async Task Main() {
        Task task = Work(); Console.WriteLine(task.IsCompleted);
        try { await task; } catch (Exception error) { Console.WriteLine(error.Message); }
      }`), engine);
    const vm = create();
    let portable;
    try {
      assert.equal(vm.run().state, 'waiting');
      assert.equal(vm.output.join(''), 'filter\nenter\nFalse\n');
      const context = [...vm.scheduler.contexts.values()].find(item => item.task &&
        item.frames.some(frame => frame.unwinds?.some(unwind => unwind.kind === 'exception')));
      assert.ok(context);
      const task = vm.scheduler.taskRecord(context.task);
      assert.equal(task.status, 'waiting', 'A task cannot complete before its asynchronous cleanup');
      const unwind = context.frames.flatMap(frame => frame.unwinds ?? []).find(item => item.kind === 'exception');
      assert.ok(unwind);
      assert.equal(unwind.search.selection, null, 'All guest catches/filters were searched before the task boundary');
      vm.heap.collect();
      assert.doesNotThrow(() => vm.heap.get(unwind.error.reference));
      const saved = vm.snapshot(), wire = await serializeSnapshot(vm, saved, {json: true});
      const expected = 'filter\nenter\nFalse\nleave\noriginal\n';
      assert.equal(finish(vm), expected);
      vm.restore(saved);
      vm.heap.collect();
      assert.equal(finish(vm), expected);
      portable = create();
      await restoreSerializedSnapshot(portable, wire);
      portable.heap.collect();
      assert.equal(finish(portable), expected);
    } finally { vm.stop(); portable?.stop(); }
  });

  test(`${engine}: an escaping await fault completes intermediate tasks and a finally fault replaces the original`, () => {
    const vm = factory(program(`
      static async Task Leaf() { await Task.Delay(1); throw new Exception("original"); }
      static async Task Middle() { await Leaf(); Console.WriteLine("unreachable middle"); }
      static async Task Work() {
        try { await Middle(); Console.WriteLine("unreachable work"); }
        finally { await Task.Yield(); Console.WriteLine("cleanup"); throw new Exception("replacement"); }
      }
      static async Task Main() {
        try { await Work(); Console.WriteLine("unreachable main"); }
        catch (Exception error) { Console.WriteLine(error.Message); }
      }`), engine)();
    try { assert.equal(finish(vm), 'cleanup\nreplacement\n'); }
    finally { vm.stop(); }
  });

  test(`${engine}: debugger pending-fault resume delivers the completed task before another opcode`, () => {
    const vm = factory(program(`
      static async Task Work() { await Task.Yield(); throw new Exception("paused"); }
      static async Task Main() {
        try { await Work(); Console.WriteLine("unreachable"); }
        catch (Exception error) { Console.WriteLine(error.Message); }
      }`), engine)();
    vm.onException = () => true;
    try {
      let result = vm.run();
      for (let attempt = 0; attempt < 100 && result.state === 'waiting'; attempt++) {
        const delay = vm.scheduler.nextDelay();
        assert.notEqual(delay, null);
        vm.scheduler.advance(delay);
        result = vm.run();
      }
      assert.equal(result.state, 'paused');
      assert.ok(vm.pendingFault);
      const saved = vm.snapshot();
      vm.onException = null;
      vm.state = 'running';
      assert.equal(finish(vm), 'paused\n');
      vm.restore(saved);
      vm.state = 'running';
      assert.equal(finish(vm), 'paused\n');
    } finally { vm.stop(); }
  });

  test(`${engine}: process, thread, suppressed callback and fatal faults preserve their first-pass frames`, () => {
    const create = factory(program(`static void Main() {
      try { throw new Exception("inspect"); } finally { Console.WriteLine("cleanup"); }
    }`), engine);
    for (const mode of ['process', 'thread', 'suppressed', 'fatal']) {
      const vm = create();
      try {
        if (mode !== 'process') {
          const task = vm.scheduler.createTask();
          vm.scheduler.current.task = task.ref;
          vm.scheduler.current.kind = mode === 'thread' ? 'thread' : 'task';
          vm.scheduler.suppressed = mode === 'suppressed';
        }
        const original = vm.frames.slice();
        const fault = new ManagedFault(mode === 'fatal' ? 'InstructionLimitException' : 'Exception', 'inspect');
        if (engine === 'cil') vm.raise(fault);
        else vm.handleFault(fault);
        assert.equal(vm.state, 'faulted');
        assert.equal(vm.fault, fault);
        assert.deepEqual(vm.frames, original);
        assert.equal(vm.output.join(''), '');
        assert.equal(fault.phase, 'unhandled');
      } finally { vm.scheduler.suppressed = false; vm.stop(); }
    }
  });
}
