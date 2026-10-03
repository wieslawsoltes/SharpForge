import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {comparePerformance, qualifyBaseline, gateOptions} from '../scripts/perf-gate.js';
import {bootstrapRegression, distribution} from '../bench/vm/statistics.js';
import {validateReport} from '../bench/vm/report-validation.js';
import {reportFixture} from './a05-12-fixtures.js';

const baseline = () => qualifyBaseline(reportFixture(), reportFixture({day: 2}));

test('T12 independent bootstrap rejects a clear slowdown and preserves noise-level changes', () => {
  const before = Array.from({length: 40}, (_, index) => 10 + index % 5 / 10);
  const result = bootstrapRegression(before, before.map(value => value * 1.2), {seed: 7, resamples: 1000});
  assert.equal(result.regression, true);
  assert(result.interval[0] > 0.05);
  assert.deepEqual(result, bootstrapRegression(before, before.map(value => value * 1.2), {seed: 7, resamples: 1000}));
  assert.equal(bootstrapRegression(before, before.map(value => value * 1.01), {resamples: 1000}).regression, false);
});

test('T12 full gate detects slower execution and accepts one-percent noise', () => {
  assert.equal(comparePerformance(baseline(), reportFixture({day: 3, factor: 1.2}), {resamples: 1000}).status, 'regression');
  assert.equal(comparePerformance(baseline(), reportFixture({day: 3, factor: 1.01}), {resamples: 1000}).status, 'passed');
});

test('T12 zero allocations use an absolute boundary; exact threshold and equal samples pass', () => {
  assert.equal(bootstrapRegression(Array(20).fill(0), Array(20).fill(1), {resamples: 1000}).regression, true);
  assert.equal(bootstrapRegression(Array(20).fill(0), Array(20).fill(0), {resamples: 1000}).regression, false);
  assert.equal(bootstrapRegression(Array(20).fill(100), Array(20).fill(100), {resamples: 1000}).regression, false);
  assert.equal(bootstrapRegression(Array(20).fill(100), Array(20).fill(105), {resamples: 1000}).regression, false);
  assert.equal(distribution([1, 2, 3, 4]).median, 2.5);
});

test('T12 the checked-in unmeasured baseline cannot pass', () => {
  const empty = JSON.parse(readFileSync(new URL('../docs/performance/a05-baseline.json', import.meta.url)));
  if (empty.status === 'unqualified') assert.throws(() => comparePerformance(empty, reportFixture()), /measured/);
  else validateReport(empty, {baseline: true});
});

for (const [name, mutate] of [
  ['missing case', report => report.rows.pop()],
  ['duplicate case', report => report.rows.push(report.rows[0])],
  ['missing metric', report => delete report.rows[0].metrics.executionMs],
  ['NaN sample', report => { report.rows[0].samples[2].executionMs = NaN; }],
  ['negative sample', report => { report.rows[0].samples[2].managedAllocations = -1; }],
  ['missing samples', report => report.rows[0].samples.pop()],
  ['failed correctness', report => { report.rows[0].samples[2].outputVerified = false; }],
  ['cancelled run', report => { report.status = 'cancelled'; }],
  ['dirty commit', report => { report.worktreeStatus = ' M vm.js'; }],
  ['different runtime', report => { report.environment.node = 'different'; }],
  ['unmeasured case', report => { report.rows[0].status = 'unsupported'; }],
  ['reversed metric', report => { report.rows[0].metrics.executionMs.direction = 'lower'; }],
]) test(`T12 rejects ${name}`, () => {
  const candidate = reportFixture({day: 3});
  mutate(candidate);
  assert.throws(() => comparePerformance(baseline(), candidate, {resamples: 1000}));
});

test('T12 baseline requires distinct serial repeats on the same commit with stable medians', () => {
  assert.throws(() => qualifyBaseline(reportFixture(), reportFixture()), /separate serial/);
  assert.throws(() => qualifyBaseline(reportFixture(), reportFixture({day: 2, factor: 1.2})), /5%/);
  const other = reportFixture({day: 2});
  other.commit = 'b'.repeat(40);
  assert.throws(() => qualifyBaseline(reportFixture(), other), /same commit/);
});

test('T12 malformed gate configuration is rejected even when observations are identical', () => {
  for (const options of [{seed: -1}, {resamples: 1}, {confidence: 1}, {threshold: -1}]) {
    assert.throws(() => comparePerformance(baseline(), reportFixture({day: 3}), options));
  }
  assert.throws(() => gateOptions(['--candidate']), /missing/);
  assert.throws(() => gateOptions(['--candidate', 'x', '--invented', 'y']), /Unknown/);
});
