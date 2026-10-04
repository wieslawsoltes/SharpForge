import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, ManagedFault, SnapshotVersionError} from '@sharpforge/runtime';
import {copyExecution} from '../packages/runtime/src/snapshot.js';
import {executionCodeStatistics} from '@sharpforge/runtime';

const artifact = compileToIL('int n=1;while(n<8){n=n+1;}Console.WriteLine(n);');
assert(artifact.success, JSON.stringify(artifact.diagnostics));
const machine = engine => engine === 'source' ? new VirtualMachine(artifact.image)
  : new CilVirtualMachine(artifact.assembly);

for (const engine of ['source', 'cil']) {
  test(`${engine}: scheduler, active frames and pending faults restore one alias graph`, () => {
    const vm = machine(engine);
    vm.scheduler.ensure();
    const fault = new ManagedFault('Exception', 'first chance');
    vm.pendingFault = fault;
    vm.fault = fault;
    vm.top.exception = fault;
    vm.scheduler.current.resumeFault = fault;
    const saved = vm.snapshot();
    const context = new Map(saved.scheduler.contexts).get(saved.scheduler.currentId);
    assert.equal(context.frames, saved.frames);
    assert.equal(context.pendingFault, saved.pendingFault);
    assert.equal(context.resumeFault, saved.pendingFault);
    assert.equal(saved.frames[0].exception, saved.fault);
    if (engine === 'source') assert.equal(context.stack, saved.stack);
    vm.restore(saved);
    assert.equal(vm.scheduler.current.frames, vm.frames);
    assert.equal(vm.scheduler.current.pendingFault, vm.pendingFault);
    assert.equal(vm.pendingFault, vm.top.exception);
    assert.notEqual(vm.pendingFault, fault);
    assert.notEqual(vm.frames, saved.frames);
  });

  test(`${engine}: invalid components and versions reject before replacing live state or caches`, () => {
    const vm = machine(engine), saved = vm.snapshot();
    vm.runSlice({instructionBudget: 3, timeBudgetMs: 1000});
    const frames = vm.frames, records = vm.heap.records, epoch = executionCodeStatistics(vm).epoch;
    const reject = (value, match) => {
      assert.throws(() => vm.restore(value), match);
      assert.equal(vm.frames, frames);
      assert.equal(vm.heap.records, records);
      assert.equal(executionCodeStatistics(vm).epoch, epoch);
    };
    reject({...saved, schemaVersion: -1}, SnapshotVersionError);
    reject({...saved, nativeIntBits: 16}, /ABI/);
    reject({...saved, platform: {...saved.platform, windows: [['x']]}}, /platform windows/);
    reject({...saved, heap: {...saved.heap, stats: {...saved.heap.stats, liveBytes: 1}}}, /accounting/);
    reject({...saved, frames: [{...saved.frames[0], id: saved.frameId + 1}]}, /frame identity/);
    const currentId = vm.top.id;
    assert.throws(() => vm.scheduler.restore(saved.scheduler), error =>
      error.name === 'InvalidOperationException' && /vm.restore/.test(error.message));
    assert.equal(vm.top.id, currentId);
  });

  test(`${engine}: captured references remain valid after live collection and handles never move backwards`, () => {
    const vm = machine(engine), reference = vm.heap.string('captured');
    vm.returnValue = reference;
    const handle = vm.heap.createHandle(reference), saved = vm.snapshot();
    vm.heap.releaseHandle(handle);
    vm.returnValue = null;
    vm.heap.collect();
    const newer = vm.heap.string('later');
    const laterHandle = vm.heap.createHandle(newer);
    assert.throws(() => vm.heap.get(reference), {name: 'InvalidReferenceException'});
    vm.restore(saved);
    assert.equal(vm.heap.get(vm.returnValue).data, 'captured');
    assert.equal(vm.heap.getHandle(handle), reference);
    assert.equal(vm.heap.getHandle(laterHandle), null);
    assert(vm.heap.createHandle(reference).id > laterHandle.id);
    const next = vm.heap.string('next');
    assert(next.g > newer.g);
  });

  test(`${engine}: randomized instruction boundaries replay deterministically`, () => {
    let seed = 0x5a170006;
    for (let run = 0; run < 24; run++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const vm = machine(engine);
      vm.runSlice({instructionBudget: 1 + seed % 29, timeBudgetMs: 1000});
      const saved = vm.snapshot(), expected = vm.run();
      assert.equal(expected.output, '8\n');
      for (let replay = 0; replay < 2; replay++) {
        vm.restore(saved);
        const actual = vm.run();
        assert.equal(actual.output, expected.output);
        assert.equal(actual.state, expected.state);
      }
    }
  });
}

for (const engine of ['source', 'cil']) {
  test(`${engine}: restore before the first memory allocation preserves later monotonic identities`, () => {
    const vm = machine(engine), saved = vm.snapshot();
    vm.memorySequence = 17;
    vm.restore(saved);
    assert.equal(vm.memorySequence, 17);
  });
}

test('execution copies preserve sparse local capacity, holes, cycles and null prototypes', () => {
  const locals = new Array(5);
  locals[1] = locals;
  const record = Object.create(null);
  record.locals = locals;
  const copied = copyExecution(record);
  assert.equal(Object.getPrototypeOf(copied), null);
  assert.equal(copied.locals.length, 5);
  assert.equal(Object.hasOwn(copied.locals, 4), false);
  assert.equal(copied.locals[1], copied.locals);
});
