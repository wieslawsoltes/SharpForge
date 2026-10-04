/** Deferred qualification: source/reloaded dispatch, cold plans, raw warmed samples and the T07 1.5x target. */
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, executionCodeStatistics} from '@sharpforge/runtime';
import {distribution, evidence, failure, publish, requireResult} from './a05-evidence.mjs';

const programs = [
  {name: 'loop', expected: '199990000\n', source:
    'class P {static void Main(){int sum=0;for(int i=0;i<20000;i++)sum+=i;Console.WriteLine(sum);}}'},
  {name: 'fibonacci', expected: '987\n', source:
    'class P {static int F(int n){if(n<2)return n;return F(n-1)+F(n-2);}static void Main(){Console.WriteLine(F(16));}}'},
];
const report = evidence('SF-A05-T07 source fusion', import.meta.filename);
report.minimumSpeedup = 1.5;
try {
  for (const program of programs) {
    const artifact = compileToIL(program.source);
    requireResult(artifact.success, 'Benchmark compilation failed', artifact.diagnostics);
    for (const engine of ['source', 'reloaded-source']) {
      const image = engine === 'source' ? artifact.image : loadAssembly(artifact.assembly);
      const row = {name: program.name, engine, samples: [], passed: false};
      report.results.push(row);
      for (const sourceFusion of [false, true]) {
        const started = performance.now();
        const vm = new VirtualMachine(image, {sourceFusion, maxInstructions: 500000000});
        const constructionMs = performance.now() - started;
        for (let sample = 0; sample < 25; sample++) {
          if (sample) {
            vm.output = []; vm.outputCharacters = 0; vm.returnValue = null;
            vm.call(image.entryPoint, []); vm.state = 'running';
          }
          const before = {...vm.heap.stats}, instructions = vm.instructions;
          const begin = performance.now(), result = vm.run(), milliseconds = performance.now() - begin;
          requireResult(result.state === 'terminated' && result.output === program.expected,
            'Source fusion output mismatch', {sourceFusion, sample, result});
          row.samples.push({sourceFusion, sample, phase: sample === 0 ? 'cold' : sample < 5 ? 'warmup' : 'measured',
            milliseconds, constructionMs: sample === 0 ? constructionMs : null,
            instructions: vm.instructions - instructions, heapBefore: before, heapAfter: {...vm.heap.stats},
            code: executionCodeStatistics(vm)});
        }
        vm.stop();
      }
      const samples = enabled => row.samples.filter(sample => sample.sourceFusion === enabled && sample.phase === 'measured');
      row.ordinary = distribution(samples(false).map(sample => sample.milliseconds));
      row.fused = distribution(samples(true).map(sample => sample.milliseconds));
      row.speedup = row.ordinary.median / row.fused.median;
      row.passed = row.speedup >= report.minimumSpeedup && samples(true).some(sample => sample.code.sourceFusionGroups > 0);
    }
  }
  report.passed = report.results.every(row => row.passed);
} catch (error) {
  report.errors.push(failure(error));
} finally {
  publish(report, process.argv[2]);
}
