import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hostedPlan, validateHostedPlan} from '../scripts/a05/hosted-plan.js';
import {assessHostedResult, aggregateHostedResults} from '../scripts/a05/hosted-results.js';
import {runHostedQueue} from '../scripts/a05/hosted-queue.js';
import {runHostedProcess, withHostedBudget} from '../scripts/a05/hosted-process.js';
import {boundedRead, cgroupPaths, hostedEnvironment} from '../scripts/a05/hosted-environment.js';
import {artifactInventory, requireOutside} from '../scripts/a05/hosted-provenance.js';
import {parseQualificationOptions} from '../bench/vm/qualification-options.js';
import {parseLatencyOptions} from '../bench/vm/latency-options.js';
import {hostedMemoryResult} from '../scripts/a05/hosted-memory-results.js';
import {assessFloatIterationCriterion} from '../bench/vm/float-allocation-criterion.js';

const measured = (rows, extra = {}) => ({commit: 'revision', completedCommit: 'revision', worktreeStatus: '',
  completedWorktreeStatus: '', status: 'measured', errors: [], acceptance: 'met',
  rows: rows.map(id => ({id, status: 'measured'})), ...extra});
const temporary = context => {
  const directory = mkdtempSync(join(tmpdir(), 'a05-hosted-test-'));
  context.after(() => rmSync(directory, {recursive: true, force: true}));
  return directory;
};

test('hosted plan admits every fixed qualification command with exact ABI, counts and distinct outputs', () => {
  const plan = hostedPlan('/evidence', '/reference');
  assert.equal(plan.length, 25);
  assert.deepEqual(plan.slice(0, 2).map(row => row.id), ['source-fibonacci', 'virtual-cache']);
  assert.equal(new Set(plan.map(row => row.output)).size, plan.length);
  for (const row of plan.filter(item => item.argv.includes('bench/vm/qualification.js'))) {
    const options = parseQualificationOptions(row.argv.slice(row.argv.indexOf('bench/vm/qualification.js') + 1));
    assert.equal(options.seed, 12012);
    assert.equal(options.resamples, 10000);
    const numeric = options.suite === 'differential';
    assert.equal(options.nativeBits, numeric || options.suite === 'fairness' ? 32 : 64);
    assert.equal(options.samples, numeric || options.suite === 'fairness' ? 20 : 100);
    assert.equal(options.warmup, ['roots', 'profiler'].includes(options.suite) ? 10 : 3);
    if (numeric) assert.equal(options.width === '32' ? options.int32Cases : options.int64Cases,
      options.width === '32' ? 1000000 : 10000000);
  }
  for (const name of ['byref', 'array']) {
    const row = plan.find(item => item.id === name + '-latency');
    const options = parseLatencyOptions(row.argv.slice(row.argv.indexOf(`bench/vm/${name}-latency.js`) + 1), name);
    assert.equal(options.samples, 100);
    assert.equal(options.warmup, 10);
  }
  assert.deepEqual(plan.find(row => row.id === 't12-baseline').dependencies, ['t12-first', 't12-repeat']);
  assert.equal(plan.filter(row => row.kind === 't12').length, 2);
  validateHostedPlan(plan, '/evidence', '/reference');
  plan[0].argv[plan[0].argv.indexOf('--samples') + 1] = '20';
  assert.throws(() => validateHostedPlan(plan, '/evidence', '/reference'), /committed fixed plan/);
});

test('enabled and allocation reporting retain intentional exit2 without converting a missed gate into success', () => {
  const command = {kind: 'profiler-on', rows: ['on']};
  const report = measured(['on'], {acceptance: 'incomplete', profilerCoverage: {enabledOverhead: {missing: []}}});
  const observed = assessHostedResult(command, {exitCode: 2}, report, 'revision');
  assert.equal(observed.status, 'satisfied');
  assert.equal(observed.rawAcceptance, 'incomplete');
  assert.equal(assessHostedResult({...command, kind: 'profiler-off'}, {exitCode: 2}, report, 'revision').status, 'unmet');
  assert.equal(assessHostedResult(command, {exitCode: 2}, {...report, rows: []}, 'revision').status, 'unmet');
  const allocation = measured([], {acceptance: 'partial', perIterationAllocationCriterion: {acceptance: 'met'}});
  assert.equal(assessHostedResult({kind: 'float', rows: []}, {exitCode: 2}, allocation, 'revision').status, 'unmet');
  allocation.perIterationAllocationCriterion.acceptance = 'inconclusive';
  assert.equal(assessHostedResult({kind: 'float', rows: []}, {exitCode: 2}, allocation, 'revision').status, 'unmet');
});

test('memory qualification recomputes actual retained observations and refuses forged or partial success labels', () => {
  const allocation = JSON.parse(readFileSync(new URL('../planning/qualification/a05-evidence/float-allocation-2026-10-04/' +
    'a05-float-allocation-single-boundary-warm-slices.json', import.meta.url), 'utf8'));
  allocation.perIterationAllocationCriterion = assessFloatIterationCriterion(allocation.rows, allocation.positiveAllocationControl);
  assert.equal(hostedMemoryResult('float', allocation), true);
  allocation.rows[1].samples[1].trace.reportedAllocatedBytes += 1000000;
  assert.equal(allocation.perIterationAllocationCriterion.acceptance, 'met');
  assert.equal(hostedMemoryResult('float', allocation), false);
  const snapshot = JSON.parse(readFileSync(new URL(
    '../planning/qualification/a05-evidence/snapshot-retention-2026-10-04/original-clean.json', import.meta.url), 'utf8'));
  assert.equal(hostedMemoryResult('snapshot', snapshot), true);
  snapshot.rows[0].restoreEquivalence.revisions--;
  assert.equal(snapshot.rows[0].assessment.status, 'met-for-this-workload');
  assert.equal(hostedMemoryResult('snapshot', snapshot), false);
});

test('failed reference blocks only its dependent off command while independent misses and later work remain recorded', async context => {
  const directory = temporary(context);
  const commands = hostedPlan(directory, directory + '-reference').filter(row =>
    ['source-fibonacci', 'profiler-reference', 'profiler-off', 'source-integer-loop'].includes(row.id));
  const journal = {expectedCommit: 'revision', commands: commands.map(row => ({...row, status: 'pending'}))};
  const calls = [];
  let saves = 0;
  await runHostedQueue({journal, product: directory, directory, save() { saves++; }}, {
    identity: () => ({commit: 'revision'}), observe: () => ({}), retain: () => assert.fail('failed reference cannot be retained'),
    run: async options => { calls.push(options.argv); return {exitCode: options.argv.includes('source-integer-loop') ? 0 : 2}; },
    read: path => path.includes('profiler-reference') ? {status: 'failed'} : measured(
      [path.includes('source-integer-loop') ? 'source-integer-loop' : 'source-fibonacci'])
  });
  assert.equal(calls.length, 3);
  assert.equal(journal.commands.find(row => row.id === 'profiler-off').status, 'blocked');
  assert.equal(journal.commands.at(-1).assessment.status, 'satisfied');
  assert.equal(journal.commands[0].process.exitCode, 2);
  assert.ok(saves >= 7);
  assert.equal(aggregateHostedResults(journal.commands).status, 'unmet');
});

test('source mutation blocks all later commands and missing reports stay failures', async context => {
  const directory = temporary(context);
  const journal = {expectedCommit: 'revision', commands: hostedPlan(directory, directory + '-reference')
    .slice(0, 2).map(row => ({...row, status: 'pending'}))};
  let checks = 0;
  await runHostedQueue({journal, product: directory, directory, save() {}}, {
    identity() { if (++checks > 1) throw new Error('mutated'); return {}; }, observe: () => ({}),
    run: async () => ({exitCode: 0}), read: () => assert.fail('mutated source must not accept a report')
  });
  assert.equal(journal.commands[0].status, 'failed');
  assert.equal(journal.commands[1].status, 'blocked');
  assert.equal(journal.provenanceFailure.message, 'mutated');
  const first = journal.commands[0];
  assert.equal(assessHostedResult(first, {exitCode: 0}, null, 'revision').status, 'unmet');
  assert.equal(assessHostedResult(first, {exitCode: 0}, measured(first.rows, {completedCommit: 'changed'}), 'revision').status, 'unmet');
});

test('a successful off report cannot qualify after reference mutation; later independent work still executes', async context => {
  const directory = temporary(context);
  const commands = hostedPlan(directory, directory + '-reference').filter(row =>
    ['profiler-reference', 'profiler-off', 'source-integer-loop'].includes(row.id));
  const journal = {expectedCommit: 'revision', commands: commands.map(row => ({...row, status: 'pending'}))};
  await runHostedQueue({journal, product: directory, directory, save() {}}, {
    identity: () => ({commit: 'revision'}), observe: () => ({}), retain() {}, run: async () => ({exitCode: 0}),
    verifyReference: async () => ({process: {exitCode: 1}, report: {status: 'failed', error: {message: 'Reference changed'}}}),
    read: path => path.includes('profiler-reference') ? {status: 'created', sourceCommit: 'revision'} :
      measured(commands.find(row => row.output === path).rows)
  });
  const off = journal.commands[1];
  assert.equal(off.process.exitCode, 0);
  assert.equal(off.referenceAfter.process.exitCode, 1);
  assert.equal(off.assessment.status, 'unmet');
  assert.equal(journal.commands[2].assessment.status, 'satisfied');
});

test('literal child argv retains nonzero exit, both output streams and cancellation without overwrite', async context => {
  const directory = temporary(context);
  const script = join(directory, 'child.mjs');
  writeFileSync(script, "process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 2;\n");
  const log = join(directory, 'child.log');
  const result = await runHostedProcess({argv: [script], cwd: directory, env: process.env, log});
  assert.equal(result.exitCode, 2);
  assert.equal(readFileSync(log, 'utf8'), 'outerr');
  await assert.rejects(runHostedProcess({argv: [script], cwd: directory, env: process.env, log}), /EEXIST/);
  const controller = new AbortController();
  controller.abort();
  const stopped = await runHostedProcess({argv: [script], cwd: directory, env: process.env,
    log: join(directory, 'cancelled.log'), signal: controller.signal});
  assert.equal(stopped.cancelled, true);
  assert.equal(stopped.exitCode, null);
  assert.equal((await artifactInventory(directory)).length, 3);
  writeFileSync(script, 'setInterval(() => {}, 1000);\n');
  const running = new AbortController();
  const timer = setTimeout(() => running.abort(), 100);
  try {
    const interrupted = await runHostedProcess({argv: [script], cwd: directory, env: process.env,
      log: join(directory, 'interrupted.log'), signal: running.signal});
    assert.equal(interrupted.cancelled, true);
    assert.equal(interrupted.exitCode, null);
    assert.ok(['SIGTERM', 'SIGKILL'].includes(interrupted.signal));
  } finally { clearTimeout(timer); }
});

test('runner sidecar bounds reads, records unavailable controls, and excludes environment secrets', context => {
  const directory = temporary(context);
  const path = join(directory, 'large');
  writeFileSync(path, 'x'.repeat(100));
  assert.equal(boundedRead(path, 8).text.length, 8);
  assert.equal(boundedRead(path, 8).truncated, true);
  assert.equal(boundedRead(join(directory, 'missing')).unavailable, 'ENOENT');
  assert.ok(cgroupPaths('0::/../../secret').every(item => item.startsWith('/sys/fs/cgroup/')));
  const environment = hostedEnvironment({GITHUB_RUN_ID: '123', GITHUB_TOKEN: 'never-record', SECRET: 'never-record'});
  assert.equal(environment.github.GITHUB_RUN_ID, '123');
  assert.equal(JSON.stringify(environment).includes('never-record'), false);
  assert.throws(() => requireOutside(directory, join(directory, 'nested')), /outside/);
  assert.doesNotThrow(() => requireOutside(directory, directory + '-evidence'));
});

test('setup cannot start a child after the common infrastructure budget has already elapsed', async context => {
  const directory = temporary(context);
  const script = join(directory, 'must-not-run.mjs');
  writeFileSync(script, "throw new Error('expired setup executed');\n");
  const result = await withHostedBudget(new Date(Date.now() - 341 * 60 * 1000).toISOString(), signal =>
    runHostedProcess({argv: [script], cwd: directory, env: process.env, log: join(directory, 'expired.log'), signal}));
  assert.equal(result.cancelled, true);
  assert.equal(result.exitCode, null);
  assert.equal(readFileSync(join(directory, 'expired.log'), 'utf8'), '');
});
