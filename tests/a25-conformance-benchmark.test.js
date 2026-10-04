import test from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarizeSamples, compareBenchmarkBaseline } from '../packages/git/bench/metrics.js';

test('benchmark reports median, p95 and p99 from retained raw samples', () => {
  assert.equal(percentile([10, 30, 20], 0.5), 20);
  const result = summarizeSamples([10, 20, 30].map(milliseconds => ({ milliseconds, peakRssBytes: milliseconds * 100, peakHeapBytes: 500 })));
  assert.equal(result.medianMs, 20);
  assert.equal(result.p95Ms, 29);
  assert.equal(result.p99Ms, 29.8);
  assert.equal(result.peakRssBytes, 3000);
  assert.equal(result.raw.length, 3);
});

test('benchmark gate rejects mismatched profiles and every time or memory regression above twenty percent', () => {
  const baseline = { schema: 'fixture', profile: { files: 100 }, measurements: {
    clone: { medianMs: 100, p95Ms: 100, p99Ms: 100, peakRssBytes: 100 }
  } };
  const result = structuredClone(baseline);
  result.measurements.clone.medianMs = 120;
  assert.deepEqual(compareBenchmarkBaseline(result, baseline), []);
  result.measurements.clone.p99Ms = 121;
  result.measurements.clone.peakRssBytes = 122;
  assert.deepEqual(compareBenchmarkBaseline(result, baseline).map(value => value.metric), ['p99Ms', 'peakRssBytes']);
  result.profile.files = 101;
  assert.throws(() => compareBenchmarkBaseline(result, baseline), /profile/);
});
