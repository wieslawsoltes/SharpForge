import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmark} from '../../../scripts/conformance/perf/core.js';
import {combineMeasurements} from '../../../scripts/conformance/perf/combine.js';

const sample = pause => ({nodeHeapDeltaBytes: -16, managed: {
  allocationsPerOperation: 1, bytesPerOperation: 40, maxPauseMs: pause, collections: 2
}});
const measured = (ms, pause) => benchmark({id: 'A05/control', area: 'A05', engine: 'fixture',
  samples: [ms], coldSamples: [ms + 1], checksum: '42',
  metrics: {samples: [sample(pause)], allocationSummary: {stable: true}}
});

test('paired reports recompute GC stability across independent processes', () => {
  const first = measured(10, 1), second = measured(11, 3);
  const combined = combineMeasurements([first, second]);
  assert.deepEqual(combined.samples, [10, 11]);
  assert.deepEqual(combined.coldSamples, [11, 12]);
  assert.deepEqual(combined.metrics.samples, [sample(1), sample(3)]);
  assert.equal(combined.metrics.allocationSummary.stable, false);
  assert.equal(combined.metrics.allocationSummary.maxPauseMsRange.relativeSpread, 2);
  assert.equal(combined.correctness.checksum, '42');
  assert.equal(first.metrics.allocationSummary.stable, true);
});

test('missing managed samples cannot be silently dropped from combined evidence', () => {
  const missing = measured(12, 1);
  delete missing.metrics;
  const combined = combineMeasurements([measured(10, 1), missing]);
  assert.deepEqual(combined.metrics.samples, [sample(1), null]);
  assert.equal(combined.metrics.allocationSummary.status, 'unsupported');
  missing.metrics = {samples: []};
  assert.throws(() => combineMeasurements([measured(10, 1), missing]), /Metric sample count/);
});

test('combined reports reject mixed identities and correctness results', () => {
  assert.throws(() => combineMeasurements([]), /No benchmark/);
  for (const key of ['id', 'area', 'engine']) {
    assert.throws(() => combineMeasurements([measured(10, 1), {...measured(11, 1), [key]: 'different'}]), /identities/);
  }
  const wrong = measured(11, 1);
  wrong.correctness.checksum = '43';
  assert.throws(() => combineMeasurements([measured(10, 1), wrong]), /Nondeterministic/);
});
