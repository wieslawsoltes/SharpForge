import {performance} from 'node:perf_hooks';
import {cpus, release} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Session} from 'node:inspector/promises';
import {readDesignSource, DesignDocument, planDesignSourceUpdate} from '@sharpforge/designer';
import {fuzzSource} from '../../tests/fixtures/a18/fuzz.js';

const filename = fileURLToPath(import.meta.url);
const options = {uri: 'Fuzz.cs', className: 'View', methodName: 'Create'};
const argumentsSet = new Set(process.argv.slice(2));
for (const argument of argumentsSet) if (argument !== '--cold-worker') throw new Error('Unknown argument: ' + argument);

function sample(action) {
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const value = action();
  const milliseconds = performance.now() - start;
  global.gc?.();
  const retainedHeapBytes = process.memoryUsage().heapUsed - heapBefore;
  if (!value) throw new Error('Benchmark action did not retain its result for the measurement boundary.');
  return {milliseconds, retainedHeapBytes};
}

function summarize(samples) {
  const values = samples.map(sample => sample.milliseconds).sort((left, right) => left - right);
  const heaps = samples.map(sample => sample.retainedHeapBytes).sort((left, right) => left - right);
  const percentile = probability => values[Math.min(values.length - 1, Math.ceil(probability * values.length) - 1)];
  return {
    samples: values.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
    medianRetainedHeapBytes: heaps[Math.floor(heaps.length / 2)],
  };
}

async function sampleAllocations(action) {
  const profiler = new Session();
  const iterations = 31;
  profiler.connect();
  try {
    await profiler.post('HeapProfiler.startSampling', {
      samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true,
    });
    for (let index = 0; index < iterations; index++) {
      if (!action()) throw new Error('Allocation benchmark returned no result.');
    }
    const {profile} = await profiler.post('HeapProfiler.stopSampling');
    let estimatedBytes = 0;
    const pending = [profile.head];
    while (pending.length) {
      const node = pending.pop();
      estimatedBytes += node.selfSize;
      pending.push(...node.children);
    }
    return {iterations, samplingIntervalBytes: 4096, sampledObjects: profile.samples.length,
      estimatedBytes, estimatedBytesPerOperation: estimatedBytes / iterations};
  } finally {
    profiler.disconnect();
  }
}

if (argumentsSet.has('--cold-worker')) {
  process.stdout.write(JSON.stringify(sample(() => readDesignSource(fuzzSource, options))) + '\n');
} else {
  const cold = Array.from({length: 11}, () => JSON.parse(execFileSync(process.execPath,
    ['--expose-gc', filename, '--cold-worker'], {encoding: 'utf8', maxBuffer: 1024 * 1024})));
  const baseline = readDesignSource(fuzzSource, options);
  const document = new DesignDocument(baseline.document);
  document.setProperty('Width', 211, ['action']);
  const operations = {
    warmSemanticRead: () => readDesignSource(fuzzSource, options),
    warmNoChangePlan: () => planDesignSourceUpdate(baseline, baseline.document),
    warmScalarPlan: () => planDesignSourceUpdate(baseline, document.value, baseline.sources, {requireCompilation: true}),
  };
  const warm = {};
  const allocations = {};
  for (const [name, action] of Object.entries(operations)) {
    for (let index = 0; index < 10; index++) action();
    warm[name] = summarize(Array.from({length: 51}, () => sample(action)));
    allocations[name] = await sampleAllocations(action);
  }
  const cwd = fileURLToPath(new URL('../../', import.meta.url));
  const report = {
    schemaVersion: 1,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim(),
    workingTree: execFileSync('git', ['status', '--porcelain'], {cwd, encoding: 'utf8'}).trim() ? 'modified' : 'clean',
    command: ['node', '--expose-gc', 'examples/a18-qualification/benchmark.mjs'],
    environment: {node: process.version, platform: process.platform, architecture: process.arch, os: release(), cpu: cpus()[0]?.model},
    input: {utf16CodeUnits: fuzzSource.length, nodes: baseline.document.nodes.length},
    coldSemanticRead: summarize(cold), ...warm,
    allocations,
    allocationMethod: 'Separate V8 sampling heap-profiler passes include collected objects and profiler overhead; byte estimates are not exact counts.',
    measurement: 'Cold reads use fresh processes after module loading. Empirical percentiles include shared-host noise. No speedup claim.',
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  document.dispose();
}
