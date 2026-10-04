import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

export const protocol = Object.freeze({ measuredRounds: 100, warmupRounds: 20, operationsPerSample: 1,
  order: 'Forward/reverse workload order alternates by round; paired libraries share one process and identical inputs',
  first: 'First timed call after untimed correctness checks; not process-cold',
  timing: 'Only operation() is timed; result consumption, assertions, disposal and memory observation are outside timing',
  allocation: 'Observed per-operation heapUsed/ArrayBuffer deltas include GC noise; not total allocation counters' });

const median = (values) => {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const percentile = (values, fraction) => [...values].sort((left, right) => left - right)[Math.ceil(values.length * fraction) - 1];

/** Preserve chronological samples; every returned value is consumed and cleaned up outside the timed operation. */
export function measurePdbWorkloads(workloads) {
  const chronologicalSamples = [];
  let consumedChecksum = 0;
  globalThis.gc?.();
  const phases = [{ name: 'first', rounds: 1 }, { name: 'warmup', rounds: protocol.warmupRounds },
    { name: 'measured', rounds: protocol.measuredRounds }];
  for (const phase of phases) {
    for (let round = 0; round < phase.rounds; round++) {
      const ordered = round % 2 ? [...workloads].reverse() : workloads;
      for (const workload of ordered) {
        const before = process.memoryUsage();
        const start = performance.now();
        const result = workload.operation();
        const elapsedMs = performance.now() - start;
        const after = process.memoryUsage();
        let consumed;
        try {
          consumed = workload.consume(result);
          assert(Number.isSafeInteger(consumed), 'Benchmark result consumer must produce an integer');
          consumedChecksum = (consumedChecksum + consumed) >>> 0;
        } finally {
          workload.cleanup?.(result);
        }
        chronologicalSamples.push({ phase: phase.name, round, library: workload.library, workload: workload.name,
          elapsedMs, consumed, heapDeltaBytes: after.heapUsed - before.heapUsed,
          arrayBufferDeltaBytes: after.arrayBuffers - before.arrayBuffers });
      }
    }
  }
  const summary = workloads.map((workload) => {
    const matching = chronologicalSamples.filter((sample) => sample.library === workload.library && sample.workload === workload.name);
    const samples = matching.filter((sample) => sample.phase === 'measured');
    const times = samples.map((sample) => sample.elapsedMs);
    assert.equal(samples.length, protocol.measuredRounds);
    return { library: workload.library, workload: workload.name, measuredSamples: samples.length,
      firstTimedMs: matching.find((sample) => sample.phase === 'first').elapsedMs,
      medianMs: median(times), p95Ms: percentile(times, 0.95), p99Ms: percentile(times, 0.99),
      medianHeapDeltaBytes: median(samples.map((sample) => sample.heapDeltaBytes)),
      medianArrayBufferDeltaBytes: median(samples.map((sample) => sample.arrayBufferDeltaBytes)) };
  });
  return { protocol, consumedChecksum, summary, chronologicalSamples };
}
