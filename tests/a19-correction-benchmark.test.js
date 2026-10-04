import assert from 'node:assert/strict';
import test from 'node:test';
import { benchmark, plan, jsonHash, parseArguments, summarize, validateReport, compareReports }
  from '../scripts/benchmarks/a19-correction-report.mjs';

function report(nanoseconds = 100) {
  return { schemaVersion: 1, benchmark, plan: structuredClone(plan), passed: true, failures: [],
    source: { revision: 'a'.repeat(40), tree: 'b'.repeat(40), trackedClean: true, untrackedPaths: ['docs/unrelated.md'] },
    harness: { sha256: 'c'.repeat(64) },
    environment: { node: 'v22.fixture', v8: 'fixture', platform: 'linux', architecture: 'x64',
      cpu: 'Fixture CPU', logicalCpus: 2, execArgv: [], nodeOptions: '' },
    cases: plan.cases.map(specification => {
      const samples = Array(plan.samples).fill(nanoseconds * specification.operations);
      return { id: specification.id, operations: specification.operations, passed: true,
        nativeTimeouts: { before: 0, afterOperations: 0, afterTurn: 0, afterDispose: 0 },
        fixtureSha256: jsonHash(specification), correctnessSha256: jsonHash({ id: specification.id, exact: true }),
        firstOperationNs: nanoseconds, warmupBatchNs: Array(plan.warmups).fill(nanoseconds * specification.operations),
        sampleBatchNs: samples, summary: summarize(samples, specification.operations) };
    }) };
}

test('CLI requires explicit checkouts or both reports and preserves paths containing spaces', () => {
  assert.deepEqual(parseArguments(['capture', '--checkout', '/a root', '--output', '/result.json']),
    { mode: 'capture', checkout: '/a root', output: '/result.json' });
  assert.deepEqual(parseArguments(['compare', '--candidate', 'after', '--baseline', 'before', '--output', 'result']),
    { mode: 'compare', candidate: 'after', baseline: 'before', output: 'result' });
  for (const values of [[], ['toString'], ['capture', '--checkout', 'root'],
    ['capture', '--output', 'one', '--output', 'two'], ['capture', '--samples', '101', '--output', 'result']]) {
    assert.throws(() => parseArguments(values), /Usage|Invalid/);
  }
});

test('nearest-rank raw batch summaries divide by operations without mutating input', () => {
  const values = Array.from({ length: 101 }, (_, index) => (101 - index) * 4);
  assert.deepEqual(summarize(values, 4), { medianNs: 51, p95Ns: 96 });
  assert.equal(values[0], 404);
  for (const values of [[], [NaN], [Infinity], [-1], [1.5], [null]]) assert.throws(() => summarize(values, 1));
  assert.throws(() => summarize([1], 0));
});

test('matching captures retain different revisions and unrelated untracked inventory', () => {
  const before = report();
  const after = report();
  after.source.revision = 'd'.repeat(40);
  after.source.untrackedPaths = [];
  const compared = compareReports(before, after);
  assert.equal(compared.comparable, true);
  assert.equal(compared.reviewRequired, false);
  assert.equal(compared.cases.length, 4);
});

test('strict greater-than-five-percent review boundary applies to median and p95', () => {
  assert.equal(compareReports(report(100), report(105)).reviewRequired, false);
  assert.equal(compareReports(report(100), report(106)).reviewRequired, true);
  const after = report();
  const row = after.cases[0];
  row.sampleBatchNs.fill(106 * row.operations, 95);
  row.summary = summarize(row.sampleBatchNs, row.operations);
  const compared = compareReports(report(), after).cases[0];
  assert.equal(compared.metrics.medianNs.reviewRequired, false);
  assert.equal(compared.metrics.p95Ns.reviewRequired, true);
});

test('missing, duplicate, partial or failed scopes cannot become passing baselines', () => {
  for (const change of [value => value.cases.pop(), value => { value.cases[1].id = value.cases[0].id; },
    value => value.cases[0].sampleBatchNs.pop(), value => value.cases[0].warmupBatchNs.pop(),
    value => { value.cases[0].passed = false; }, value => { value.passed = false; },
    value => value.failures.push({ message: 'retained failure' })]) {
    const value = report();
    change(value);
    assert.throws(() => compareReports(value, report()));
  }
});

test('invalid raw numbers, forged summaries, missing identities and zero baselines fail closed', () => {
  for (const change of [value => { value.cases[0].sampleBatchNs[0] = NaN; },
    value => { value.cases[0].firstOperationNs = null; }, value => { value.cases[0].summary.medianNs++; },
    value => { value.source.trackedClean = false; }, value => { value.harness.sha256 = ''; },
    value => { value.cases[0].nativeTimeouts.afterDispose = 1; },
    value => { delete value.environment.cpu; }]) {
    const value = report();
    change(value);
    assert.throws(() => validateReport(value));
  }
  assert.throws(() => compareReports(report(0), report()), /Zero baseline/);
});

test('changed workload, correctness, harness, Node, CPU, OS or flags are incompatible', () => {
  for (const change of [value => { value.plan.samples++; }, value => { value.cases[0].fixtureSha256 = 'd'.repeat(64); },
    value => { value.cases[0].correctnessSha256 = 'e'.repeat(64); }, value => { value.harness.sha256 = 'f'.repeat(64); },
    value => { value.environment.node = 'v24.fixture'; }, value => { value.environment.cpu = 'Other CPU'; },
    value => { value.environment.platform = 'win32'; }, value => { value.environment.execArgv = ['--jitless']; }]) {
    const after = report();
    change(after);
    assert.throws(() => compareReports(report(), after));
  }
});
