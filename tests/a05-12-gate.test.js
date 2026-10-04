import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {comparePerformance, qualifyBaseline, gateOptions, compareMetric} from '../scripts/perf-gate.js';
import {bootstrapRegression, distribution} from '../bench/vm/statistics.js';
import {validateReport} from '../bench/vm/report-validation.js';
import {finalizeRow} from '../bench/vm/evidence.js';
import {reportFixture, syntheticOptions} from './a05-12-fixtures.js';

const baseline = options => qualifyBaseline(reportFixture(options), reportFixture({...options, day: 2}), syntheticOptions);

test('T12 independent bootstrap rejects a clear slowdown and preserves noise-level changes', () => {
  const before = Array.from({length: 40}, (_, index) => 10 + index % 5 / 10);
  const result = bootstrapRegression(before, before.map(value => value * 1.2), {seed: 7, resamples: 1000});
  assert.equal(result.regression, true);
  assert(result.interval[0] > 0);
  assert.equal(result.intervalUnit, 'metric-units-over-budget');
  assert.deepEqual(result, bootstrapRegression(before, before.map(value => value * 1.2), {seed: 7, resamples: 1000}));
  assert.equal(compareMetric(before, before.map(value => value * 1.01), {resamples: 1000}).regression, false);
});

test('T12 point slowdown within broad independent noise remains explicitly inconclusive', () => {
  const before = Array.from({length: 40}, (_, index) => index + 1);
  const result = compareMetric(before, before.map(value => value * 1.08), {resamples: 1000});
  assert.equal(result.decision, 'inconclusive');
  assert.equal(result.regression, false);
  assert(result.interval[0] < 0);
});

test('T12 full gate detects slower execution and accepts one-percent noise', () => {
  assert.equal(comparePerformance(baseline(), reportFixture({day: 3, factor: 1.2}), syntheticOptions).status, 'regression');
  assert.equal(comparePerformance(baseline(), reportFixture({day: 3, factor: 1.01}), syntheticOptions).status, 'passed');
});

test('T12 zero allocations use an absolute boundary; exact budget and equal samples pass', () => {
  assert.equal(bootstrapRegression(Array(20).fill(0), Array(20).fill(1), {resamples: 1000}).regression, true);
  assert.equal(bootstrapRegression(Array(20).fill(0), Array(20).fill(0), {resamples: 1000}).regression, false);
  assert.equal(bootstrapRegression(Array(20).fill(100), Array(20).fill(100), {resamples: 1000}).regression, false);
  assert.equal(bootstrapRegression(Array(20).fill(100), Array(20).fill(105), {resamples: 1000}).regression, false);
  assert.equal(compareMetric(Array(20).fill(100), Array(20).fill(95), {direction: 'lower'}).regression, false);
  assert.equal(distribution([1, 2, 3, 4]).median, 2.5);
  assert.equal(distribution([1, 2, 3, 4]).interquartileRange, 1.5);
  assert.equal(distribution([1, 2, 3, 4]).medianAbsoluteDeviation, 1);
});

test('T12 allocation bootstrap accepts zero-denominator draws without imputing epsilon values', () => {
  const before = [...Array(9).fill(0), ...Array(11).fill(1)];
  const result = bootstrapRegression(before, Array(20).fill(2), {resamples: 1000});
  assert(result.interval.every(Number.isFinite));
  assert.equal(result.before, 1);
  assert.equal(result.after, 2);
  assert.throws(() => bootstrapRegression(Array(20).fill(0), Array(20).fill(1), {direction: 'lower'}), /throughput/);
});

test('T12 production gate rejects synthetic observations and the checked-in unmeasured baseline', () => {
  assert.throws(() => qualifyBaseline(reportFixture(), reportFixture({day: 2})), /Synthetic/);
  assert.throws(() => comparePerformance(baseline(), reportFixture({day: 3})), /Synthetic/);
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
  ['fractional allocation', report => { report.rows[0].samples[2].managedAllocations = 0.5; }],
  ['missing samples', report => report.rows[0].samples.pop()],
  ['duplicate sample index', report => { report.rows[0].samples[3].index = 2; }],
  ['reordered warmup', report => { report.rows[0].samples[2].phase = 'first'; }],
  ['fabricated throughput', report => { report.rows[0].samples[2].instructionsPerSecond *= 2; }],
  ['fabricated summary', report => { report.rows[0].summary.executionMs.median *= 2; }],
  ['failed correctness', report => { report.rows[0].samples[2].outputVerified = false; }],
  ['cancelled run', report => { report.status = 'cancelled'; }],
  ['dirty commit', report => { report.worktreeStatus = ' M vm.js'; }],
  ['changed revision', report => { report.completedCommit = 'b'.repeat(40); }],
  ['different runtime', report => { report.environment.node = 'different'; }],
  ['unmeasured case', report => { report.rows[0].status = 'unsupported'; }],
  ['reversed metric', report => { report.rows[0].metrics.executionMs.direction = 'lower'; }],
]) test(`T12 rejects ${name}`, () => {
  const candidate = reportFixture({day: 3});
  mutate(candidate);
  assert.throws(() => comparePerformance(baseline(), candidate, syntheticOptions));
});

test('T12 baseline requires distinct serial repeats on the same revision with stable medians', () => {
  assert.throws(() => qualifyBaseline(reportFixture(), reportFixture(), syntheticOptions), /separate serial/);
  assert.throws(() => qualifyBaseline(reportFixture(), reportFixture({day: 2, factor: 1.2}), syntheticOptions), /5%/);
  const other = reportFixture({day: 2});
  other.commit = other.completedCommit = 'b'.repeat(40);
  assert.throws(() => qualifyBaseline(reportFixture(), other, syntheticOptions), /same commit/);
});

test('T12 repeat qualification rejects a new allocation from an originally zero-allocation case', () => {
  const first = reportFixture();
  for (const row of first.rows) {
    for (const sample of row.samples) sample.managedAllocations = 0;
    finalizeRow(row);
  }
  assert.throws(() => qualifyBaseline(first, reportFixture({day: 2}), syntheticOptions), /5%/);
});

test('T12 baseline qualification is checked from raw evidence', () => {
  const qualified = baseline();
  qualified.qualification.stability[0].stable = false;
  assert.throws(() => comparePerformance(qualified, reportFixture({day: 3}), syntheticOptions), /qualification evidence/);
});

test('T12 optional phases remain unavailable rather than pretending to be zero-duration measurements', () => {
  const options = {suite: 'all', engine: 'source', portableSnapshots: false,
    sourcePreparation: {status: 'not-required', reason: 'No separate source preparation phase in the fixture runtime'}};
  const result = comparePerformance(baseline(options), reportFixture({...options, day: 3}), syntheticOptions);
  assert.equal(result.status, 'passed');
  assert.equal(result.unsupported.length, 0);
  assert.equal(result.unavailablePhases.length, 4);
  const malformed = reportFixture({...options, day: 3});
  malformed.rows.find(row => row.kind === 'snapshot').samples[0].exportMs = 0;
  assert.throws(() => validateReport(malformed, syntheticOptions), /fabricated duration/);
});

test('T12 malformed gate configuration is rejected even when observations are identical', () => {
  for (const options of [{seed: -1}, {resamples: 1}, {confidence: 1}, {threshold: -1}, {probability: 2}]) {
    assert.throws(() => comparePerformance(baseline(), reportFixture({day: 3}), {...syntheticOptions, ...options}));
  }
  for (const args of [['--candidate'], ['--candidate', 'x', '--invented', 'y'],
    ['--candidate', 'x', '--candidate', 'y'], ['--candidate', 'x', '--out', 'x'],
    ['--qualify', 'first', '--repeat', 'second', '--baseline', 'old']]) assert.throws(() => gateOptions(args));
});
