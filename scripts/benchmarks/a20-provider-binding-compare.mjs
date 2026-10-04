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

function measurements(phase) {
  return {elapsedMs: phase.metrics.elapsedMs,
    ...(phase.queryCount ? {queryCount: phase.queryCount, elapsedPerQueryMs: phase.metrics.elapsedPerQueryMs} : {}),
    retainedHeapDeltaBytes: phase.metrics.retainedHeapDeltaBytes,
    uncollectedHeapDeltaBytes: phase.metrics.uncollectedHeapDeltaBytes};
}

const queryPhases = new Set(['signature-first-query', 'signature-repeated-query', 'compiled-model-first-query']);
const rows = [];
for (const before of baseline.cases) {
  const after = candidate.cases.find(entry => entry.name === before.name);
  if (!after || before.sourceSha256 !== after.sourceSha256) throw new Error(`Source corpus differs: ${before.name}`);
  if (before.phases.length !== after.phases.length) throw new Error(`Benchmark phases differ: ${before.name}`);
  for (const oldPhase of before.phases) {
    const newPhase = after.phases.find(entry => entry.phase === oldPhase.phase);
    if (!newPhase || oldPhase.queryCount !== newPhase.queryCount) throw new Error(`Benchmark phase differs: ${before.name}/${oldPhase.phase}`);
    if (oldPhase.available === false) {
      if (!queryPhases.has(oldPhase.phase)) throw new Error(`Required baseline phase is unavailable: ${oldPhase.phase}`);
      rows.push({case: before.name, phase: oldPhase.phase, comparison: newPhase.available ? 'candidate-only' : 'unavailable',
        baseline: {available: false, reason: oldPhase.reason},
        candidate: newPhase.available ? {...measurements(newPhase), evidence: newPhase.evidence} :
          {available: false, reason: newPhase.reason}});
      continue;
    }
    if (newPhase.available === false || oldPhase.evidenceSha256 !== newPhase.evidenceSha256) {
      throw new Error(`Compiler/source-model observations differ: ${before.name}/${oldPhase.phase}; review behavior before timing`);
    }
    const oldTime = oldPhase.metrics.elapsedMs;
    const newTime = newPhase.metrics.elapsedMs;
    const medianChangePercent = (newTime.median / oldTime.median - 1) * 100;
    rows.push({case: before.name, phase: oldPhase.phase, comparison: 'before-after',
      baseline: measurements(oldPhase), candidate: measurements(newPhase),
      medianChangePercent, p95ChangePercent: (newTime.p95 / oldTime.p95 - 1) * 100,
      retainedHeapMedianDifferenceBytes: newPhase.metrics.retainedHeapDeltaBytes.median - oldPhase.metrics.retainedHeapDeltaBytes.median,
      observedMedianSlowdownAboveFivePercent: medianChangePercent > 5});
  }
}
process.stdout.write(JSON.stringify({baselineRevision: baseline.revision, candidateRevision: candidate.revision,
  warning: 'Descriptive before/after measurements only; shared-host noise and statistical significance are not inferred.', rows}, null, 2) + '\n');
