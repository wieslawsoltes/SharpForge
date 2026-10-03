/** Execute only after the complete E01 integration is released for qualification. */
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {distribution, evidence, failure, publish, requireResult} from './a05-evidence.mjs';

const fixtures = [{
  name: 'primitive-vector', expected: '16256\n',
  source: `int[] values=new int[128];
    for(int i=0;i<128;i++){values[i]=i*2;}
    int sum=0;for(int i=0;i<128;i++){sum+=values[i];}Console.WriteLine(sum);`
}, {
  name: 'rectangular-array', expected: '8128\n',
  source: `int[,] values=new int[16,8];
    for(int row=0;row<values.GetLength(0);row++){
      for(int col=0;col<values.GetLength(1);col++){values[row,col]=row*8+col;}
    }
    int sum=0;for(int row=0;row<16;row++){for(int col=0;col<8;col++){sum+=values[row,col];}}
    Console.WriteLine(sum);`
}, {
  name: 'stack-span-readonly-slices', expected: '8416\n424\n',
  source: `Span<int> values=stackalloc int[128];for(int i=0;i<128;i++){values[i]=i+1;}
    Span<int> tail=values.Slice(8,16);for(int i=0;i<tail.Length;i++){tail[i]+=10;}
    ReadOnlySpan<int> view=values;int sum=0;for(int i=0;i<view.Length;i++){sum+=view[i];}
    Console.WriteLine(sum);ReadOnlySpan<int> part=view.Slice(8,16);
    sum=0;for(int i=0;i<part.Length;i++){sum+=part[i];}Console.WriteLine(sum);`
}];
const report = evidence('SF-A05-T03/T05 integrated memory latency', import.meta.filename);
report.warmupIterations = 5;
report.measuredIterations = 100;
report.workload = '128 elements per fixture; vector writes/reads, 16x8 rectangular writes/reads, stack-backed Span mutation through a slice and ReadOnlySpan reads.';

function construct(engine, artifact, nativeIntBits) {
  if (engine === 'cil') return new CilVirtualMachine(artifact.assembly, {nativeIntBits});
  return new VirtualMachine(engine === 'source' ? artifact.image : loadAssembly(artifact.assembly), {nativeIntBits});
}
function execute(engine, artifact, {nativeIntBits, expected, iteration}) {
  const start = performance.now();
  const vm = construct(engine, artifact, nativeIntBits);
  const initialized = performance.now();
  const initialAllocations = vm.heap.stats.allocations;
  const initialBytes = vm.heap.stats.allocatedBytes;
  const result = vm.run();
  const completed = performance.now();
  requireResult(result.state === 'terminated' && result.output.replaceAll('\r\n', '\n') === expected,
    'Integrated memory benchmark output differs', {engine, nativeIntBits, iteration, expected, state: result.state, output: result.output, fault: result.fault?.stack});
  const sample = {
    iteration, phase: iteration === 0 ? 'first' : iteration <= report.warmupIterations ? 'warmup' : 'measured',
    constructionMs: initialized - start, executionMs: completed - initialized, totalMs: completed - start,
    instructions: vm.instructions, output: result.output,
    managedInitializationAllocations: initialAllocations, managedInitializationBytes: initialBytes,
    managedExecutionAllocations: vm.heap.stats.allocations - initialAllocations,
    managedExecutionBytes: vm.heap.stats.allocatedBytes - initialBytes,
    managedHeap: {...vm.heap.stats}
  };
  vm.stop();
  return sample;
}
try {
  for (const fixture of fixtures) {
    const at = performance.now();
    const artifact = compileToIL(fixture.source);
    requireResult(artifact.success, 'Memory benchmark compilation failed', {fixture: fixture.name, diagnostics: artifact.diagnostics});
    const compilationMs = performance.now() - at;
    for (const engine of ['source', 'reloaded-source', 'cil']) for (const nativeIntBits of [32, 64]) {
      const result = {fixture: fixture.name, source: fixture.source, expected: fixture.expected, engine, nativeIntBits, compilationMs, passed: false, samples: []};
      report.results.push(result);
      try {
        for (let iteration = 0; iteration <= report.warmupIterations + report.measuredIterations; iteration++) {
          result.samples.push(execute(engine, artifact, {nativeIntBits, expected: fixture.expected, iteration}));
        }
        const measured = result.samples.filter(sample => sample.phase === 'measured');
        result.firstIteration = result.samples[0];
        result.warm = Object.fromEntries(['constructionMs', 'executionMs', 'totalMs', 'managedExecutionAllocations', 'managedExecutionBytes']
          .map(key => [key, distribution(measured.map(sample => sample[key]))]));
        result.passed = true;
      } catch (error) {
        result.error = failure(error);
        report.errors.push({fixture: fixture.name, engine, nativeIntBits, ...failure(error)});
      }
    }
  }
  report.passed = report.results.length === fixtures.length * 6 && report.results.every(result => result.passed);
} catch (error) {
  report.errors.push(failure(error));
} finally {
  publish(report, process.argv[2]);
}
