import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {SyncPrimitives} from '../packages/runtime/src/execution/sync-primitives.js';
import {address} from '../packages/runtime/src/execution/control-pointers.js';

function factories(source) {
  const compiled = compileToIL(source);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  return {source: () => new VirtualMachine(compiled.image, {virtualTime: true}),
    cil: () => new CilVirtualMachine(compiled.assembly, {virtualTime: true})};
}

const cleanup = factories('class P {static void Log(){Console.WriteLine("cleanup");}'
  + 'static void F(){try{throw new Exception("saved");}finally{Log();}}'
  + 'static void Main(){try{F();}catch(Exception e){Console.WriteLine(e.Message);}}}');
const awaiting = factories('using System.Threading.Tasks;class P {static void Cleanup(){Console.WriteLine("finally");}'
  + 'static async Task Main(){try{Console.WriteLine("start");await Task.Delay(10);Console.WriteLine("after");}'
  + 'finally{Cleanup();}}}');
const booleanLocal = factories('class P {static void Main(){bool flag=false;Console.WriteLine(flag);}}');
const filtering = factories('class P {static bool Match(){Console.WriteLine("filter");return true;}'
  + 'static void Main(){try{throw new Exception("saved");}catch(Exception e)when(Match()){Console.WriteLine(e.Message);}}}');

for (const engine of ['source', 'cil']) {
  test(`${engine}: portable pending first-chance faults and nested finally calls replay their exact continuation`, async () => {
    const vm = cleanup[engine]();
    vm.onException = () => true;
    vm.run();
    assert.equal(vm.state, 'paused');
    assert(vm.pendingFault);
    const pending = vm.snapshot(), inFinally = [];
    vm.onException = null;
    for (let step = 0; step < 200 && !['terminated', 'faulted'].includes(vm.state); step++) {
      vm.state = 'running';
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
      if (inFinally.length < 4 && vm.frames.length > 2 && vm.frames.some(frame => frame.unwinds?.length)) {
        inFinally.push(vm.snapshot());
      }
    }
    assert.equal(vm.state, 'terminated', vm.fault?.message);
    assert.equal(vm.output.join(''), 'cleanup\nsaved\n');
    assert(inFinally.length > 0, 'Observe a nested call while finally owns an unwind');
    for (const saved of [pending, ...inFinally]) {
      const wire = await serializeSnapshot(vm, saved), fresh = cleanup[engine]();
      await restoreSerializedSnapshot(fresh, structuredClone(wire));
      // CIL run() preserves debugger pauses. Resume the restored first-chance
      // stop through the same state transition used by the debugger.
      if (fresh.state === 'paused') fresh.state = 'running';
      const actual = fresh.run();
      assert.equal(actual.state, 'terminated', actual.fault?.message);
      assert.equal(actual.output, 'cleanup\nsaved\n');
      fresh.stop();
    }
    vm.stop();
  });

  test(`${engine}: awaiting contexts replay after original cancellation and collection`, async () => {
    const vm = awaiting[engine]();
    assert.equal(vm.run().state, 'waiting', vm.fault?.message);
    const wire = await serializeSnapshot(vm, vm.snapshot(), {json: true});
    vm.stop();
    vm.heap.collect();
    // Canceled task rows may retain historical references that the collector already cleared.
    await serializeSnapshot(vm);
    for (let replay = 0; replay < 2; replay++) {
      const fresh = awaiting[engine]();
      await restoreSerializedSnapshot(fresh, wire);
      const result = await fresh.runAsync();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, 'start\nafter\nfinally\n');
      fresh.stop();
    }
  });

  test(`${engine}: executing filters preserve their declaring storage and exception-search cursor`, async () => {
    const vm = filtering[engine]();
    let filter;
    for (let step = 0; step < 200 && !filter && !['terminated', 'faulted'].includes(vm.state); step++) {
      vm.state = 'running';
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
      filter = vm.frames.find(frame => frame.filterSearch);
    }
    assert(filter, vm.fault?.message ?? 'Observe an executing filter');
    const saved = vm.snapshot(), captured = saved.frames.find(frame => frame.filterSearch);
    const owner = saved.frames.find(frame => frame.id === captured.filterOwnerId);
    assert.equal(captured.locals, owner.locals);
    captured.filterSearch.locations.set(owner.id, captured.filterSearch.locations.get(owner.id) + 1);
    assert.throws(() => vm.restore(saved), /exception search location/);
    assert.equal(vm.frames.find(frame => frame.filterSearch), filter);
    const wire = await serializeSnapshot(vm), fresh = filtering[engine]();
    await restoreSerializedSnapshot(fresh, wire);
    const restored = fresh.frames.find(frame => frame.filterSearch);
    assert.equal(restored.locals, fresh.frames.find(frame => frame.id === restored.filterOwnerId).locals);
    const actual = fresh.run();
    assert.equal(actual.state, 'terminated', actual.fault?.message);
    assert.equal(actual.output, 'filter\nsaved\n');
    vm.stop();
    fresh.stop();
  });

  test(`${engine}: monitor queues restore into a fresh lazy component with exact task and Boolean flag aliases`, async () => {
    const vm = booleanLocal[engine]();
    const flagIndex = () => {
      const locals = engine === 'cil' ? vm.top?.method.locals : vm.image.methods[vm.top?.methodId]?.locals.map(local => local.type);
      return locals?.findIndex(type => type === 'bool' || type === 'System.Boolean') ?? -1;
    };
    // Compilation can introduce an entry wrapper with no user locals. Capture
    // the actual Main frame before creating the second scheduler context.
    for (let step = 0; step < 100 && flagIndex() < 0 && ['ready', 'running'].includes(vm.state); step++) {
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    }
    assert(flagIndex() >= 0, 'Enter the method declaring the Boolean lock flag');
    vm.scheduler.ensure();
    const beforeSync = vm.snapshot();
    vm.sync = new SyncPrimitives(vm);
    const gate = vm.heap.object('object', []);
    vm.returnValue = gate;
    vm.sync.enter(gate);
    const entry = engine === 'cil' ? vm.top.method.token : vm.top.methodId;
    const second = vm.scheduler.enqueueCall(entry);
    vm.scheduler.load(vm.scheduler.contexts.get(second));
    const index = flagIndex();
    assert(index >= 0);
    vm.top.locals[index] = engine === 'cil' ? 0 : false;
    const flag = address(vm, 'local', index);
    vm.sync.enter(gate, {flag});
    assert.equal(vm.scheduler.current.status, 'waiting');
    vm.scheduler.load(vm.scheduler.contexts.get(1));
    const saved = vm.snapshot(), blocks = vm.sync.blocks, originalSync = vm.sync;
    saved.sync.blocks[0][1].entries[0].contextId = 1;
    assert.throws(() => vm.restore(saved), /synchronization wait/);
    assert.equal(vm.sync.blocks, blocks);
    assert.equal(vm.scheduler.contexts.get(second).status, 'waiting');
    const wire = await serializeSnapshot(vm), fresh = booleanLocal[engine]();
    assert.equal(fresh.sync, undefined);
    await restoreSerializedSnapshot(fresh, wire);
    const block = [...fresh.sync.blocks.values()][0], queued = block.entries[0];
    assert.equal(block.owner, 1);
    assert.equal(queued.contextId, second);
    fresh.sync.exit(block.reference);
    assert.equal(block.owner, second);
    assert.equal(fresh.scheduler.contexts.get(second).status, 'ready');
    fresh.scheduler.load(fresh.scheduler.contexts.get(second));
    assert.equal(fresh.dereference(queued.flag), engine === 'cil' ? 1 : true);
    fresh.sync.exit(block.reference);
    assert.equal(fresh.sync.blocks.size, 0);
    vm.restore(beforeSync);
    assert.equal(vm.sync, undefined, 'Restoring before the first monitor removes its later component');
    assert.equal(originalSync.blocks.size, 0, 'A retained old component no longer owns synchronization state');
    fresh.stop();
    vm.stop();
  });
}
