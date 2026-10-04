import {readFileSync} from 'node:fs';

const [baselinePath, candidatePath] = process.argv.slice(2);
if (!baselinePath || !candidatePath || process.argv.length !== 4) {
  throw new Error('Usage: a20-provider-binding-compare.mjs BASELINE_JSON CANDIDATE_JSON');
}
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const baseline = read(baselinePath);
const candidate = read(candidatePath);

if (baseline.benchmark !== candidate.benchmark || baseline.benchmarkSha256 !== candidate.benchmarkSha256 ||
    JSON.stringify(baseline.settings) !== JSON.stringify(candidate.settings)) {
  throw new Error('Benchmark source or settings differ; these reports are not comparable');
}
for (const key of ['node', 'v8', 'platform', 'architecture', 'cpu', 'logicalCpus', 'totalMemoryBytes',
  'execArgv', 'nodeOptions', 'heapSizeLimitBytes']) {
  if (JSON.stringify(baseline.environment[key]) !== JSON.stringify(candidate.environment[key])) {
    throw new Error(`Benchmark environments differ: ${key}`);
  }
}
if (baseline.cases.length !== candidate.cases.length) throw new Error('Benchmark corpus differs');

const rows = [];
for (const before of baseline.cases) {
  const after = candidate.cases.find(entry => entry.name === before.name);
  if (!after || before.sourceSha256 !== after.sourceSha256) throw new Error(`Source corpus differs: ${before.name}`);
  for (const oldPhase of before.phases) {
    const newPhase = after.phases.find(entry => entry.phase === oldPhase.phase);
    if (!newPhase || oldPhase.evidenceSha256 !== newPhase.evidenceSha256) {
      throw new Error(`Compiler/source-model observations differ: ${before.name}/${oldPhase.phase}; review behavior before timing`);
    }
    const oldTime = oldPhase.metrics.elapsedMs;
    const newTime = newPhase.metrics.elapsedMs;
    const medianChangePercent = (newTime.median / oldTime.median - 1) * 100;
    rows.push({case: before.name, phase: oldPhase.phase,
      baseline: {elapsedMs: oldTime, retainedHeapDeltaBytes: oldPhase.metrics.retainedHeapDeltaBytes,
        uncollectedHeapDeltaBytes: oldPhase.metrics.uncollectedHeapDeltaBytes},
      candidate: {elapsedMs: newTime, retainedHeapDeltaBytes: newPhase.metrics.retainedHeapDeltaBytes,
        uncollectedHeapDeltaBytes: newPhase.metrics.uncollectedHeapDeltaBytes},
      medianChangePercent, p95ChangePercent: (newTime.p95 / oldTime.p95 - 1) * 100,
      retainedHeapMedianDifferenceBytes: newPhase.metrics.retainedHeapDeltaBytes.median - oldPhase.metrics.retainedHeapDeltaBytes.median,
      observedMedianSlowdownAboveFivePercent: medianChangePercent > 5});
  }
}
process.stdout.write(JSON.stringify({baselineRevision: baseline.revision, candidateRevision: candidate.revision,
  warning: 'Descriptive before/after measurements only; shared-host noise and statistical significance are not inferred.', rows}, null, 2) + '\n');
