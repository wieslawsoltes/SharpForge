import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, prepareExecution} from '@sharpforge/runtime';
import {parseOptions} from '../bench/vm/harness.js';
import {withVM, runVM, executionSample, compileFixture} from '../bench/vm/operations.js';
import {bootstrapRegression} from '../bench/vm/statistics.js';
import {virtualAssembly} from '../bench/vm/virtual.js';
import {microbenchmarks, startupApps} from '../bench/vm/fixtures.js';
import {measureStartup} from '../bench/vm/startup.js';

const source = 'int sum=0;for(int i=0;i<20;i++){sum+=3;}Console.WriteLine(sum);';
function image() {
  const compiled = compileToIL(source);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  return compiled.image;
}

test('T12 preparation has no guest effects and is idempotent', async () => {
  await withVM(() => new VirtualMachine(image()), vm => {
    const count = vm.instructions, pc = vm.top.pc, allocations = vm.heap.stats.allocations;
    const first = prepareExecution(vm), second = prepareExecution(vm);
    assert.equal(first.status, 'prepared');
    assert.equal(second.statistics.sourcePlans, first.statistics.sourcePlans);
    assert.equal(vm.instructions, count);
    assert.equal(vm.top.pc, pc);
    assert.equal(vm.heap.stats.allocations, allocations);
    assert.equal(vm.output.join(''), '');
  });
});

test('T12 actual CIL virtual calls execute an override; source target is explicitly unsupported', async () => {
  assert.match(microbenchmarks.find(item => item.virtual).unsupported.source, /virtual call opcode/);
  await withVM(() => new CilVirtualMachine(virtualAssembly(20)), vm => {
    const count = vm.instructions;
    assert.equal(prepareExecution(vm).methods, vm.report.methods.length);
    assert.equal(vm.instructions, count);
    assert.equal(vm.run().returnValue, 140);
  });
});

test('T12 preparation rejects foreign and stopped VMs, and reports disabled source planning', async () => {
  assert.throws(() => prepareExecution({state: 'ready'}), /SharpForge/);
  await withVM(() => new VirtualMachine(image(), {sourceFusion: false}), vm => {
    assert.equal(prepareExecution(vm).status, 'unsupported');
    vm.stop();
    assert.throws(() => prepareExecution(vm), /live verified/);
  });
});

test('T12 deliberately slowed arithmetic handler produces a significant measured regression', async () => {
  const artifact = image(), fixture = {id: 'slowed-handler', expected: '60\n'};
  const measure = slow => withVM(() => new VirtualMachine(artifact), async vm => {
    prepareExecution(vm);
    const initial = vm.snapshot(), original = vm.binary.bind(vm);
    if (slow) vm.binary = (...args) => {
      const until = performance.now() + 0.15;
      while (performance.now() < until) { /* Deliberate test-only interpreter handler delay. */ }
      return original(...args);
    };
    const values = [];
    for (let index = 0; index < 23; index++) {
      vm.restore(initial);
      prepareExecution(vm);
      const sample = await executionSample(vm, fixture);
      if (index >= 3) values.push(sample.executionMs);
    }
    return values;
  });
  const normal = await measure(false), slowed = await measure(true);
  assert.equal(bootstrapRegression(normal, slowed, {resamples: 1000}).regression, true);
});

test('T12 cancellation and failed correctness always dispose the VM', async () => {
  let disposed = 0;
  const controller = new AbortController();
  controller.abort(new DOMException('cancelled test', 'AbortError'));
  await assert.rejects(withVM(() => ({state: 'ready', stop() { disposed++; }}), vm => runVM(vm, controller.signal)), /cancelled/);
  assert.equal(disposed, 1);
  await assert.rejects(withVM(() => new VirtualMachine(image()), async vm => {
    const stop = vm.stop.bind(vm);
    vm.stop = () => { disposed++; stop(); };
    await executionSample(vm, {id: 'wrong-output', expected: 'incorrect'});
  }), /incorrect result/);
  assert.equal(disposed, 2);
});

test('T12 pre-aborted cold sampling starts no worker', async () => {
  const controller = new AbortController();
  controller.abort(new DOMException('cold cancelled', 'AbortError'));
  const fixture = startupApps[0];
  await assert.rejects(measureStartup(fixture, 'cil', compileFixture(fixture), {samples: 20, vmOptions: {}}, controller.signal), /cold cancelled/);
});

test('T12 malformed and boundary harness options are explicit', () => {
  assert.equal(parseOptions(['--runner', 'test', '--samples', '20', '--native-bits', '64']).samples, 20);
  for (const args of [['--samples', '0'], ['--samples', 'NaN'], ['--warmup', '-1'], ['--native-bits', '16'],
    ['--engine', 'native-dotnet'], ['--workers', '2'], ['--samples']]) assert.throws(() => parseOptions(args));
});
