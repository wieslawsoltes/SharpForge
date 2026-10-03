/** Run only after the complete E02 scope is released for qualification. */
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, executionCodeStatistics} from '@sharpforge/runtime';
import {getDecodePlan} from '../../packages/runtime/src/execution/decode-plan.js';
import {distribution, evidence, failure, publish, requireResult} from './a05-evidence.mjs';

const report = evidence('SF-A05-T07 CIL cold decode and warm dispatch', import.meta.filename);
report.warmupIterations = 5;
report.measuredIterations = 100;
const source = 'class P {static int Main(){int total=0;for(int i=0;i<1000;i++){total+=i;}return total;}}';
try {
  const compiled = compileToIL(source);
  requireResult(compiled.success, 'Decode benchmark compilation failed', {diagnostics: compiled.diagnostics});
  for (const specialized of [false, true]) {
    const row = {specialized, samples: [], passed: false};
    report.results.push(row);
    for (let iteration = 0; iteration < report.warmupIterations + report.measuredIterations; iteration++) {
      const started = performance.now();
      const vm = new CilVirtualMachine(compiled.assembly, {specializeNumericHandlers: specialized});
      const constructed = performance.now(), method = vm.top.method;
      getDecodePlan(vm, method);
      const decoded = performance.now(), cold = executionCodeStatistics(vm);
      const result = vm.run(), completed = performance.now();
      requireResult(result.state === 'terminated' && result.returnValue === 499500,
        'Decode benchmark output differs', {state: result.state, value: result.returnValue, fault: result.fault?.stack});
      const warm = executionCodeStatistics(vm);
      requireResult(warm.decodePlans === cold.decodePlans && warm.offsetMapAllocations === cold.offsetMapAllocations,
        'Warm dispatch allocated a decode plan or offset map', {cold, warm});
      row.samples.push({iteration, phase: iteration < report.warmupIterations ? 'warmup' : 'measured',
        constructionMs: constructed - started, predecodeMs: decoded - constructed, executionMs: completed - decoded,
        instructions: vm.instructions, managedAllocations: vm.heap.stats.allocations, cold, warm});
      vm.stop();
    }
    const measured = row.samples.filter(sample => sample.phase === 'measured');
    row.distribution = Object.fromEntries(['constructionMs', 'predecodeMs', 'executionMs']
      .map(key => [key, distribution(measured.map(sample => sample[key]))]));
    row.passed = true;
  }
  report.passed = report.results.every(row => row.passed);
} catch (error) {
  report.errors.push(failure(error));
} finally {
  publish(report, process.argv[2]);
}
