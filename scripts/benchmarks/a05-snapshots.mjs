/** Execute only after the complete E01 integration is released for qualification. */
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {distribution, evidence, failure, publish, requireResult} from './a05-evidence.mjs';

const source = 'class P {static int F(int x){return x==0?0:F(x-1)+1;}static void Main(){Console.WriteLine(F(20));}}';
const report = evidence('SF-A05-T06 snapshot and portable replay latency', import.meta.filename);
report.warmupIterations = 10;
report.measuredIterations = 100;
report.source = source;
report.expected = '20\n';
report.allocationAccounting = 'In-memory sample deltas are managed VM counters. Restore rewinds counters; portable destination initialization counters are recorded separately and restored counters are not interpreted as new allocations.';
function create(engine, artifact, nativeIntBits) {
  return engine === 'cil' ? new CilVirtualMachine(artifact.assembly, {nativeIntBits})
    : new VirtualMachine(engine === 'source' ? artifact.image : loadAssembly(artifact.assembly), {nativeIntBits});
}
function output(vm) {
  const result = vm.run();
  requireResult(result.state === 'terminated' && result.output === report.expected, 'Snapshot replay output differs', {state: result.state, output: result.output, fault: result.fault?.stack});
  return result.output;
}
try {
  const artifact = compileToIL(source);
  requireResult(artifact.success, 'Snapshot benchmark compilation failed', artifact.diagnostics);
  for (const engine of ['source', 'reloaded-source', 'cil']) for (const nativeIntBits of [32, 64]) {
    const result = {engine, nativeIntBits, passed: false, samples: []};
    report.results.push(result);
    try {
      const vm = create(engine, artifact, nativeIntBits);
      for (let step = 0; step < 10000 && vm.frames.length < 12; step++) {
        vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
        requireResult(['ready', 'running'].includes(vm.state), 'Nested snapshot boundary was not reached', {state: vm.state, fault: vm.fault?.stack});
      }
      requireResult(vm.frames.length >= 12, 'Nested snapshot boundary exceeded instruction limit');
      result.frameDepth = vm.frames.length;
      for (let iteration = 0; iteration <= report.warmupIterations + report.measuredIterations; iteration++) {
        const sample = {iteration, phase: iteration === 0 ? 'first' : iteration <= report.warmupIterations ? 'warmup' : 'measured'};
        result.samples.push(sample);
        const allocations = vm.heap.stats.allocations;
        const bytes = vm.heap.stats.allocatedBytes;
        let at = performance.now();
        const saved = vm.snapshot();
        sample.captureMs = performance.now() - at;
        sample.cow = {...vm.heap.lastSnapshot};
        at = performance.now();
        vm.restore(saved);
        sample.restoreMs = performance.now() - at;
        sample.captureRestoreMs = sample.captureMs + sample.restoreMs;
        sample.managedAllocationsDelta = vm.heap.stats.allocations - allocations;
        sample.managedAllocatedBytesDelta = vm.heap.stats.allocatedBytes - bytes;
        sample.portable = [];
        for (const json of [false, true]) {
          at = performance.now();
          const wire = await serializeSnapshot(vm, saved, {json});
          const exportMs = performance.now() - at;
          at = performance.now();
          const transferred = json ? wire : structuredClone(wire);
          const transferMs = performance.now() - at;
          at = performance.now();
          const fresh = create(engine, artifact, nativeIntBits);
          const constructionMs = performance.now() - at;
          const managedInitialization = {allocations: fresh.heap.stats.allocations, allocatedBytes: fresh.heap.stats.allocatedBytes};
          at = performance.now();
          await restoreSerializedSnapshot(fresh, transferred);
          const importRestoreMs = performance.now() - at;
          sample.portable.push({json, exportMs, transferMs, constructionMs, importRestoreMs, managedInitialization, output: output(fresh)});
          fresh.stop();
        }
      }
      result.output = output(vm);
      const measured = result.samples.filter(sample => sample.phase === 'measured');
      result.firstIteration = result.samples[0];
      result.warm = Object.fromEntries(['captureMs', 'restoreMs', 'captureRestoreMs', 'managedAllocationsDelta', 'managedAllocatedBytesDelta']
        .map(key => [key, distribution(measured.map(sample => sample[key]))]));
      result.portableWarm = [false, true].map(json => ({json, ...Object.fromEntries(['exportMs', 'transferMs', 'constructionMs', 'importRestoreMs']
        .map(key => [key, distribution(measured.map(sample => sample.portable.find(item => item.json === json)[key]))]))}));
      result.passed = true;
      vm.stop();
    } catch (error) {
      result.error = failure(error);
      report.errors.push({engine, nativeIntBits, ...failure(error)});
    }
  }
  report.passed = report.results.length === 6 && report.results.every(result => result.passed);
} catch (error) {
  report.errors.push(failure(error));
} finally {
  publish(report, process.argv[2]);
}
