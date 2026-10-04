import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, prepareExecution, executionPreparationCapabilities, invalidateExecutionCode} from '@sharpforge/runtime';
import {parseOptions, protocolFor} from '../bench/vm/harness.js';
import {withVM, runVM, restoreForReplay, executionSample, compileFixture} from '../bench/vm/operations.js';
import {compareMetric} from '../bench/vm/gate.js';
import {virtualAssembly} from '../bench/vm/virtual.js';
import {microbenchmarks} from '../bench/vm/fixtures.js';
import {measureMicro} from '../bench/vm/micro.js';

const source = 'int sum=0;for(int i=0;i<20;i++){sum+=3;}Console.WriteLine(sum);';
function compiled() {
  const result = compileToIL(source);
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}

for (const engine of ['source', 'cil']) test(`T12 ${engine} preparation is idempotent and has no guest effects`, async () => {
  const artifact = compiled();
  await withVM(() => engine === 'cil' ? new CilVirtualMachine(artifact.assembly) : new VirtualMachine(artifact.image), vm => {
    const count = vm.instructions;
    const pc = vm.top.pc;
    const allocations = vm.heap.stats.allocations;
    const first = prepareExecution(vm);
    const second = prepareExecution(vm);
    assert.equal(first.status, executionPreparationCapabilities[engine].status === 'available' ? 'prepared' : 'not-required');
    assert.deepEqual(second.statistics, first.statistics);
    assert.equal(vm.instructions, count);
    assert.equal(vm.top.pc, pc);
    assert.equal(vm.heap.stats.allocations, allocations);
    assert.equal(vm.output.join(''), '');
    invalidateExecutionCode(vm, 'T12 explicit invalidation');
    assert(prepareExecution(vm).statistics.epoch > first.statistics.epoch);
  });
});

test('T12 actual CIL virtual calls execute the original class override', async () => {
  assert.equal(microbenchmarks.find(item => item.virtual).dispatchByEngine.cil, 'class-override-callvirt');
  await withVM(() => new CilVirtualMachine(virtualAssembly(20)), vm => {
    const count = vm.instructions;
    assert.equal(prepareExecution(vm).methods, vm.report.methods.length);
    assert.equal(vm.instructions, count);
    assert.equal(vm.run().returnValue, 140);
  });
  for (const count of [0, -1, 1.5, Infinity, 1000001]) assert.throws(() => virtualAssembly(count), RangeError);
});

test('T12 preparation rejects foreign/stopped VMs and reports disabled source planning honestly', async () => {
  assert.throws(() => prepareExecution({state: 'ready'}), /SharpForge/);
  await withVM(() => new VirtualMachine(compiled().image, {sourceFusion: false}), vm => {
    const status = executionPreparationCapabilities.source.status === 'available' ? 'disabled' : 'not-required';
    assert.equal(prepareExecution(vm).status, status);
    vm.stop();
    assert.throws(() => prepareExecution(vm), /live verified/);
  });
});

class DelayedArithmeticVM extends VirtualMachine {
  #delay = 0;
  setDelay(milliseconds) { this.#delay = milliseconds; }
  binary(operator, left, right, mode = 0) {
    if (this.#delay) {
      const until = performance.now() + this.#delay;
      while (performance.now() < until) { /* Deliberate test-only arithmetic handler work. */ }
    }
    return super.binary(operator, left, right, mode);
  }
}

test('T12 deliberately slowed arithmetic handler fails the same statistical gate used by reports', async () => {
  const artifact = compiled().image;
  const fixture = {id: 'slowed-handler-test-only', expected: '60\n'};
  const measure = delay => withVM(() => new DelayedArithmeticVM(artifact, {sourceFusion: false}), async vm => {
    const initial = vm.snapshot();
    vm.setDelay(delay);
    const values = [];
    for (let index = 0; index < 23; index++) {
      restoreForReplay(vm, initial);
      const sample = await executionSample(vm, fixture);
      if (index >= 3) values.push(sample.executionMs);
    }
    return values;
  });
  const normal = await measure(0);
  const slowed = await measure(0.15);
  const result = compareMetric(normal, slowed, {resamples: 1000});
  assert.equal(result.decision, 'regression');
  assert(result.interval[0] > 0);
});

test('T12 restored source execution explicitly resumes without ignoring ordinary debugger pauses', async () => {
  const fixture = {id: 'short-loop-test-only', source, expected: '60\n'};
  const protocol = {...protocolFor(parseOptions(['--runner', 'test'])), samples: 1, warmup: 1};
  const row = await measureMicro(fixture, 'source', compileFixture(fixture), protocol);
  assert.equal(row.samples.length, 3);
  assert(row.samples.every(sample => sample.outputVerified));
  await withVM(() => new VirtualMachine(compiled().image), async vm => {
    vm.state = 'paused';
    await assert.rejects(runVM(vm), /debugger pause/);
  });
});

test('T12 cancellation and failed correctness always dispose the VM', async () => {
  let disposed = 0;
  const controller = new AbortController();
  controller.abort(new DOMException('cancelled test', 'AbortError'));
  await assert.rejects(withVM(() => ({state: 'ready', stop() { disposed++; }}), vm => runVM(vm, controller.signal)), /cancelled/);
  assert.equal(disposed, 1);
  class ObservedVM extends VirtualMachine {
    stop() { disposed++; super.stop(); }
  }
  await assert.rejects(withVM(() => new ObservedVM(compiled().image), vm => executionSample(vm,
    {id: 'wrong-output', expected: 'incorrect'})), /incorrect result/);
  assert.equal(disposed, 2);
});

test('T12 malformed and boundary harness options are explicit', () => {
  assert.equal(parseOptions(['--runner', 'test', '--samples', '20', '--native-bits', '64']).samples, 20);
  for (const args of [['--samples', '0'], ['--samples', 'NaN'], ['--warmup', '-1'], ['--native-bits', '16'],
    ['--engine', 'native-dotnet'], ['--workers', '2'], ['--samples'], ['--samples', '20', '--samples', '30']]) {
    assert.throws(() => parseOptions(args));
  }
});
