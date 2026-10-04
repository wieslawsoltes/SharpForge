import test from 'node:test';
import assert from 'node:assert/strict';
import { distribution, validateOptions } from '../scripts/editor-benchmarks/common.js';
import { createEditorFixture, searchMarker } from '../scripts/editor-benchmarks/fixtures.js';
import { compareEditorPerformance, validateEditorReport } from '../scripts/check-editor-perf.js';
import { evaluateMemoryBudgets, retainedMetric } from '../scripts/editor-benchmarks/memory-budget.js';

function report(samples = [10, 10, 10]) {
  return { schemaVersion: 1, kind: 'sharpforge-editor-latency', correctness: { passed: true },
    environment: { node: 'v24.0.0', platform: 'linux', arch: 'x64', cpu: 'test-runner', commit: 'first' },
    rows: [{ backend: 'node-model', sizeBytes: 1024, operation: 'model.edit', rawSamplesMs: samples,
      ...distribution(samples), correctness: { passed: true } }] };
}

test('nearest-rank percentiles preserve raw outliers and reject malformed samples', () => {
  assert.deepEqual(distribution([8, 1, 3, 2, 6, 4, 7, 5, 100, 9]),
    { p50Ms: 5, p95Ms: 100, p99Ms: 100, minMs: 1, maxMs: 100, count: 10 });
  for (const invalid of [[], [NaN], [-1], [Infinity]]) assert.throws(() => distribution(invalid));
});

test('100MB fixture uses exact byte/code-unit size with one deterministic middle search target', () => {
  for (const size of [1024, 1024 ** 2, 10 * 1024 ** 2, 100 * 1024 ** 2]) {
    const fixture = createEditorFixture(size);
    assert.equal(fixture.text.length, size);
    assert.equal(Buffer.byteLength(fixture.text), size);
    assert.equal(fixture.text.indexOf(searchMarker), fixture.markerOffset);
    assert.equal(fixture.text.indexOf(searchMarker, fixture.markerOffset + 1), -1);
  }
  assert.throws(() => createEditorFixture(0));
  assert.throws(() => validateOptions({ samples: 0 }));
  assert.throws(() => validateOptions({ sizes: [1024 ** 3] }));
});

test('performance gate fails strictly above20percent p95 and passes exact20percent boundary', () => {
  const baseline = report();
  assert.equal(compareEditorPerformance(baseline, report([12, 12, 12])).passed, true);
  const regression = compareEditorPerformance(baseline, report([12.01, 12.01, 12.01]));
  assert.equal(regression.passed, false);
  assert(regression.rows[0].relativeChange > .20);
  for (const value of [1, 3, 7, 9, 35]) {
    assert.equal(compareEditorPerformance(report([value, value, value]), report(Array(3).fill(value * 1.2))).passed, true);
  }
});

test('retained memory budgets bound each real component and preserve signed measurement noise', () => {
  const metric = retainedMetric({ heapUsedBytes: 1024, arrayBufferBytes: 1024 }, 1024);
  assert.equal(metric.retainedBytes, 2048);
  assert.equal(metric.bytesPerMiB, 2 * 1024 ** 2);
  const row = { sizeBytes: 1024, buffer: metric, model: { retainedBytes: -20 }, undo: { retainedBytes: 16384, steps: 1 },
    tokens: { status: 'measured', retainedBytes: 1000, statistics: { syntaxEnabled: true, lexicalCharacterLimit: 2_000_000 } },
    view: { retainedBytes: 120, logicalLines: 10 } };
  assert.equal(evaluateMemoryBudgets(row).passed, true);
  for (const component of ['buffer', 'model', 'undo', 'tokens', 'view']) {
    const large = structuredClone(row);
    large[component].retainedBytes = 1024 ** 3;
    assert.equal(evaluateMemoryBudgets(large).passed, false, component);
  }
  row.tokens.statistics.syntaxEnabled = false;
  row.tokens.retainedBytes = 2 * 1024 ** 2;
  assert.equal(evaluateMemoryBudgets(row).passed, false, 'plain-text fallback remains bounded');
});

test('one regressed size/operation cannot be hidden by another faster row', () => {
  const baseline = report();
  baseline.rows.push({ ...baseline.rows[0], operation: 'model.undo64KiB' });
  const current = structuredClone(baseline);
  current.rows[0] = { ...current.rows[0], rawSamplesMs: [2, 2, 2], ...distribution([2, 2, 2]) };
  current.rows[1] = { ...current.rows[1], rawSamplesMs: [15, 15, 15], ...distribution([15, 15, 15]) };
  assert.equal(compareEditorPerformance(baseline, current).passed, false);
});

test('gate rejects missing browser evidence, changed runners, tampered percentiles and failed correctness', () => {
  const baseline = report();
  assert.throws(() => compareEditorPerformance(baseline, report(), { requireBrowser: true }), /Browser measurements/);
  const changedRunner = report();
  changedRunner.environment.cpu = 'another-cpu';
  assert.throws(() => compareEditorPerformance(baseline, changedRunner), /environment changed/);
  assert.equal(compareEditorPerformance(baseline, changedRunner, { allowEnvironmentChange: true }).passed, true);
  const invalid = report();
  invalid.rows[0].p95Ms = 1;
  assert.throws(() => validateEditorReport(invalid), /Percentile differs/);
  invalid.correctness.passed = false;
  assert.throws(() => validateEditorReport(invalid), /unsuccessful/);
});

test('zero baseline and missing/duplicate benchmark rows cannot silently pass', () => {
  assert.equal(compareEditorPerformance(report([0, 0, 0]), report([0, 0, 0])).passed, true);
  assert.equal(compareEditorPerformance(report([0, 0, 0]), report()).passed, false);
  const missing = report();
  missing.rows[0].operation = 'different';
  assert.throws(() => compareEditorPerformance(report(), missing), /Missing editor benchmark/);
  const duplicate = report();
  duplicate.rows.push(duplicate.rows[0]);
  assert.throws(() => validateEditorReport(duplicate), /Invalid editor benchmark row/);
});
