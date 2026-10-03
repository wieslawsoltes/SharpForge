/** Deferred until the full E02 scope is released for qualification. */
import {CilVirtualMachine} from '@sharpforge/runtime';
import {resolveVirtualCall} from '../../packages/runtime/src/execution/inline-cache.js';
import {cachedMethod} from '../../packages/runtime/src/execution/token-cache.js';
import {instantiatedMethod} from '../../packages/runtime/src/execution/generic-calls.js';
import {inlineCacheFixture} from '../../tests/support/inline-cache-fixture.js';
import {distribution, evidence, failure, publish, requireResult} from './a05-evidence.mjs';

const report = evidence('SF-A05-T07 virtual-call cache microbenchmark', import.meta.filename);
report.iterationsPerSample = 100000;
report.minimumSpeedup = 3;
try {
  for (const interfaceCall of [false, true]) {
    const bytes = inlineCacheFixture([0], {interfaceCall});
    const row = {interfaceCall, samples: [], passed: false};
    report.results.push(row);
    for (const enabled of [false, true]) {
      const vm = new CilVirtualMachine(bytes, {inlineCaches: enabled});
      const token = [...vm.inspector.methods.values()].find(method => method.name === 'Invoke').token;
      const method = instantiatedMethod(vm, token), frame = {method, genericIdentity: null, methodArguments: []};
      const instruction = method.instructions.find(item => item.name === 'callvirt');
      const descriptor = cachedMethod(vm, instruction.operand, frame), receiver = vm.heap.object('Receiver0', []);
      const expected = resolveVirtualCall(vm, frame, instruction, descriptor, receiver).target;
      for (let sample = 0; sample < 25; sample++) {
        const started = performance.now();
        for (let index = 0; index < report.iterationsPerSample; index++) {
          const actual = resolveVirtualCall(vm, frame, instruction, descriptor, receiver);
          if (actual.target !== expected) requireResult(false, 'Virtual target changed during benchmark', {expected, actual: actual.target});
        }
        row.samples.push({enabled, sample, phase: sample < 5 ? 'warmup' : 'measured', milliseconds: performance.now() - started});
      }
      vm.stop();
    }
    const samples = enabled => row.samples.filter(sample => sample.enabled === enabled && sample.phase === 'measured');
    row.uncached = distribution(samples(false).map(sample => sample.milliseconds));
    row.cached = distribution(samples(true).map(sample => sample.milliseconds));
    row.speedup = row.uncached.median / row.cached.median;
    row.passed = row.speedup >= report.minimumSpeedup;
  }
  report.passed = report.results.every(row => row.passed);
} catch (error) {
  report.errors.push(failure(error));
} finally {
  publish(report, process.argv[2]);
}
