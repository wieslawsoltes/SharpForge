import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { distribution } from '../../../scripts/conformance/perf/core.js';
import { beginAllocation, finishAllocation } from '../../../scripts/conformance/perf/alloc.js';
import { measuredBatches, warmupBatches } from './metadata-generations-benchmark-protocol.mjs';

/** One predetermined synchronous cohort. Setup, complete guards, disposal, statistics and I/O are outside timing. */
export function measureWorkload(workload, report) {
  const samples = [], warmups = [];
  const result = { id: workload.id, operationsPerBatch: workload.operations, unit: 'microseconds/operation',
    warmupBatches, measuredBatches, warmups, samples, statisticsScope: 'Distribution of batch means, not individual-call percentiles' };
  report.results.push(result);
  for (let round = 0; round < warmupBatches + measuredBatches; round++) {
    const phase = round < warmupBatches ? 'warmup' : 'measured';
    const outputs = new Array(workload.operations), state = workload.prepare?.(workload.operations);
    const allocation = beginAllocation(), started = performance.now();
    let completed = 0, failure;
    try {
      for (; completed < outputs.length; completed++) outputs[completed] = workload.invoke(completed, state);
    } catch (error) { failure = error; }
    const elapsedMs = performance.now() - started;
    const heap = finishAllocation(allocation);
    const sample = { sequence: report.chronologicalSamples.length, workload: workload.id, phase,
      batch: phase === 'warmup' ? round : round - warmupBatches, startedAtMilliseconds: performance.timeOrigin + started,
      operations: completed, elapsedMs, microsecondsPerOperation: completed ? elapsedMs * 1000 / completed : null,
      nodeHeapDeltaBytes: heap.nodeHeapDeltaBytes, guard: 'pending' };
    report.chronologicalSamples.push(sample);
    (phase === 'warmup' ? warmups : samples).push(sample);
    try {
      if (failure) throw failure;
      for (let index = 0; index < outputs.length; index++) workload.guard(outputs[index], index, state);
      sample.guard = 'passed';
    } catch (error) {
      sample.guard = 'failed';
      throw error;
    } finally { workload.cleanup?.(outputs, state); }
  }
  assert.equal(samples.length, measuredBatches);
  result.statistics = distribution(samples.map(sample => sample.microsecondsPerOperation));
  result.batchMilliseconds = distribution(samples.map(sample => sample.elapsedMs));
  return result;
}
