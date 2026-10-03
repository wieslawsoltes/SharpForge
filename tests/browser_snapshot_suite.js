import {serializeSnapshot, restoreSerializedSnapshot} from '../packages/runtime/src/index.js';

function require(value, message, details = {}) {
  if (value) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}
async function rejects(action, predicate, message) {
  let failure;
  try { await action(); } catch (error) { failure = error; }
  require(failure && predicate(failure), message, {error: failure?.stack, code: failure?.code});
  return {name: failure.name, code: failure.code, message: failure.message};
}
function boundary(vm, output) {
  for (let index = 0; index < 2000; index++) {
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    if (vm.output.join('') === output) return vm.snapshot();
    require(['ready', 'running'].includes(vm.state), 'Capture boundary was not reached', {state: vm.state, fault: vm.fault?.stack});
  }
  throw new Error('Capture boundary exceeded 2000 instructions');
}
const spanSource = `
Span<int> values = stackalloc int[4] {10,20,30,40};
Span<int> tail = values.Slice(1,2);
ReadOnlySpan<int> view = values;
Console.WriteLine("capture");
tail[1] = 77;
GC.Collect();
Console.WriteLine(view[2]);
Console.WriteLine(values[1]);
`;
const cleanupSource = 'class P { static void Log(){Console.WriteLine("cleanup");}'
  + 'static void F(){try{throw new Exception("saved");}finally{Log();}}'
  + 'static void Main(){try{F();}catch(Exception e){Console.WriteLine(e.Message);}}}';

/** Browser-only transfer APIs execute against the same bundled runtime as E01. */
export async function runSnapshotBrowser(check, {engines, compiled, machine, assertResult, manifest}) {
  for (const engine of engines) {
    for (const nativeIntBits of [32, 64]) {
      await check('T06 fresh VM portable stack memory ABI' + nativeIntBits, engine, async () => {
        const artifact = compiled(spanSource);
        const vm = machine(engine, artifact, {nativeIntBits});
        const saved = boundary(vm, 'capture\n');
        const captures = [];
        for (const json of [false, true]) {
          const start = performance.now();
          const wire = await serializeSnapshot(vm, saved, {json});
          captures.push({json, milliseconds: performance.now() - start, wire});
        }
        vm.stop();
        vm.heap.collect();
        const replays = [];
        for (const capture of captures) {
          const fresh = machine(engine, artifact, {nativeIntBits});
          const start = performance.now();
          await restoreSerializedSnapshot(fresh, capture.json ? capture.wire : structuredClone(capture.wire));
          const restoreMs = performance.now() - start;
          fresh.heap.collect();
          fresh.run();
          assertResult(fresh, 'capture\n77\n20\n');
          replays.push({json: capture.json, exportMs: capture.milliseconds, restoreMs, output: fresh.output.join(''), collections: fresh.heap.stats.collections});
        }
        return {schemaVersion: saved.schemaVersion, nativeIntBits, replays};
      });
    }
    await check('T06 fresh VM portable pending fault and nested finally call', engine, async () => {
      const artifact = compiled(cleanupSource);
      const vm = machine(engine, artifact);
      vm.onException = () => true;
      vm.run();
      require(vm.state === 'paused' && vm.pendingFault, 'No first-chance fault was captured', {state: vm.state, fault: vm.fault?.stack});
      const captures = [await serializeSnapshot(vm)];
      vm.onException = null;
      vm.state = 'running';
      while (vm.state === 'running') {
        vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
        if (vm.frames.length > 2 && vm.frames.some(frame => frame.unwinds?.length || frame.pending)) {
          captures.push(await serializeSnapshot(vm));
        }
      }
      assertResult(vm, 'cleanup\nsaved\n');
      require(captures.length > 1, 'No nested finally call boundary was captured');
      for (const wire of captures) {
        const fresh = machine(engine, artifact);
        await restoreSerializedSnapshot(fresh, structuredClone(wire));
        fresh.state = 'running';
        fresh.heap.collect();
        fresh.run();
        assertResult(fresh, 'cleanup\nsaved\n');
      }
      return {captures: captures.length, output: vm.output.join('')};
    });
    await check('T06 fresh VM portable awaiting contexts after original cancellation', engine, async () => {
      const artifact = compiled(manifest.awaitSource);
      const vm = machine(engine, artifact, {virtualTime: true});
      vm.run();
      require(vm.state === 'waiting', 'Expected an awaiting context', {state: vm.state, fault: vm.fault?.stack});
      const wire = await serializeSnapshot(vm, vm.snapshot(), {json: true});
      vm.stop();
      vm.heap.collect();
      const replays = [];
      for (let replay = 0; replay < 2; replay++) {
        const fresh = machine(engine, artifact, {virtualTime: true});
        await restoreSerializedSnapshot(fresh, wire);
        if (fresh.state === 'paused') fresh.state = 'running';
        fresh.heap.collect();
        await fresh.runAsync();
        assertResult(fresh, manifest.awaitOutput);
        replays.push({output: fresh.output.join(''), collections: fresh.heap.stats.collections});
      }
      return {replays};
    });
    await check('T06 schema rejection is atomic and typed', engine, async () => {
      const vm = machine(engine, compiled('Console.WriteLine(1);'));
      const saved = vm.snapshot(), frames = vm.frames, heap = vm.heap.records;
      const errors = [];
      for (const schemaVersion of [0, saved.schemaVersion + 1, String(saved.schemaVersion), null]) {
        errors.push(await rejects(() => vm.restore({...saved, schemaVersion}),
          error => error.name === 'SnapshotVersionError' && error.code === 'SNAPSHOT_SCHEMA_VERSION', 'Schema mismatch was not rejected'));
        require(vm.frames === frames && vm.heap.records === heap, 'Schema rejection mutated execution identities');
      }
      return {schemaVersion: saved.schemaVersion, errors};
    });
    await check('T06 external operation barriers report pending and completed revisions', engine, async () => {
      const artifact = compiled('Console.WriteLine(1);');
      const vm = machine(engine, artifact);
      const saved = vm.snapshot();
      let complete;
      const result = new Promise(resolve => { complete = resolve; });
      vm.platform.hostOperations.start('int', () => result, value => value);
      const pending = await rejects(() => vm.snapshot(), error => error.name === 'InvalidOperationException', 'Pending external operation allowed capture');
      complete(42);
      for (let turn = 0; vm.platform.hostOperations.active.size && turn < 100; turn++) await new Promise(resolve => setTimeout(resolve, 0));
      require(vm.platform.hostOperations.active.size === 0, 'Controlled host operation failed to complete');
      const revision = vm.platform.hostOperations.revision;
      const previous = await rejects(() => vm.restore(saved), error => error.name === 'InvalidOperationException', 'Completed external operation allowed history rewind');
      const wire = await serializeSnapshot(vm);
      const fresh = machine(engine, artifact);
      const foreignRevision = await rejects(() => restoreSerializedSnapshot(fresh, structuredClone(wire)),
        error => error.code === 'SNAPSHOT_HOST_REVISION', 'Fresh VM imported irreversible external history');
      return {revision, pending, previous, foreignRevision};
    });
  }
}
