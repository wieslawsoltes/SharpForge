import { readFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { environment, pinCheckouts, report, benchmark, sha, integer } from '../../../scripts/conformance/perf/core.js';
import { verifierBenchmarkWorkload } from './verifier-benchmark-workloads.mjs';

/** Keep every result until the batch ends so all correctness checks run outside the timer. */
export function measureVerifierBatch(workload, iterations) {
  iterations = integer(iterations, 1000, 1, 5000);
  const results = new Array(iterations);
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  for (let index = 0; index < iterations; index++) results[index] = workload.run();
  const ms = performance.now() - started;
  const heapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
  for (let index = 0; index < results.length; index++) {
    if (workload.readValue(results[index]) !== workload.expected)
      throw new Error(`Unexpected ${workload.name} result at invocation ${index}: ${JSON.stringify(results[index])}`);
  }
  return { ms, heapDeltaBytes, checkedInvocations: results.length };
}

/** Use the repository performance schema and distribution/provenance helpers, without executing native tools. */
export async function measureVerifier({ root, names, iterations, samples, warmups, harness }) {
  iterations = integer(iterations, 1000, 1, 5000);
  samples = integer(samples, 100, 2, 1000);
  warmups = integer(warmups, 20, 0, 100);
  if (!Array.isArray(names) || !names.length || names.length > 15 || new Set(names).size !== names.length)
    throw new Error('Select 1 to 15 distinct workloads');
  root = realpathSync(root);
  harness = realpathSync(harness);
  if (realpathSync(join(root, 'node_modules/@sharpforge/cil')) !== realpathSync(join(root, 'packages/cil')))
    throw new Error('Selected checkout must own its @sharpforge/cil alias');
  const pinned = pinCheckouts(root, harness);
  const env = environment(root);
  const rows = [];
  const sourceInputs = {};
  const identities = {};
  for (const name of names) {
    const workload = await verifierBenchmarkWorkload(root, name);
    for (const relative of workload.sources) sourceInputs[relative] = sha(readFileSync(join(root, relative)));
    identities[name] = { fixtureSHA256: workload.fixtureSHA256, expected: workload.expected };
    const chronological = [];
    for (let sample = 0; sample < 1 + warmups + samples; sample++) {
      const phase = sample === 0 ? 'cold' : sample <= warmups ? 'warmup' : 'measured';
      chronological.push({ sample, phase, ...measureVerifierBatch(workload, iterations) });
    }
    rows.push(benchmark({ id: `A03/typed-verifier/${name}`, area: 'A03', engine: 'node-typed-verifier',
      samples: chronological.filter(value => value.phase === 'measured').map(value => value.ms),
      coldSamples: [chronological[0].ms], checksum: sha(JSON.stringify({ name, ...identities[name], iterations })),
      metrics: { identity: identities[name], iterationsPerBatch: iterations, chronological,
        timing: 'Batch duration, including result-array writes; correctness and heap reads are outside the timer.',
        latency: 'Median/p95/p99 describe batch durations, not individual invocation latency.',
        heap: 'Raw heapUsed deltas include GC and O(iterations) retained results; not allocation counts.' } }));
  }
  const harnessFiles = ['packages/cil/tools/benchmark-object-verifier.mjs',
    'packages/cil/tools/benchmark-object-cohort.mjs', 'scripts/conformance/perf/process.js',
    'packages/cil/tools/verifier-benchmark-workloads.mjs', 'packages/cil/tools/verifier-benchmark-measure.mjs',
    'scripts/conformance/perf/core.js', 'scripts/planning/schema/validate.js',
    'planning/qualification/benchmark.schema.json'];
  const harnessSources = Object.fromEntries(harnessFiles.map(relative =>
    [relative, sha(readFileSync(resolve(harness, relative)))]));
  const provenance = { sourceInputs, harnessSources,
    nodeExecutable: { path: process.execPath, sha256: sha(readFileSync(process.execPath)) },
    protocol: { samples, warmups, coldBatches: 1, iterationsPerBatch: iterations,
      cold: 'First batch includes the first invocation and subsequent warm calls; not individual cold latency.',
      median: 'Even measured count uses mean of two middle sorted batches.',
      percentiles: 'Nearest-rank p95/p99 over measured batch durations; chronological samples are retained.' },
    host: 'Shared workspace; no isolated-host guarantee or automatic regression sign-off.' };
  for (const row of rows) row.metrics.provenance = provenance;
  pinned.verify();
  return report(rows, env, { harnessCommit: pinned.harnessCommit, producer: 'typed-verifier-batch-v1',
    unsupported: [{ target: 'native-runtime-performance', reason: 'This driver measures the Node typed-verification API only.' }] });
}
