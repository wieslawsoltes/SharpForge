import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { qualify } from '../scripts/project16-qualification.js';

const browserIds = ['workbench-docking', 'workbench-shell', 'workbench-sessions', 'workbench-lazy',
  'workbench-workflows', 'workbench-workflows-standalone', 'editor-insights', 'editor-providers', 'editor-view']
  .map(id => 'browser:' + id);
const performanceIds = ['performance', 'performance:editor-budgets', 'performance:studio-large-file', 'performance:instrumentation'];
const allIds = ['node:A19', 'node:A20', ...browserIds, ...performanceIds];
function invocationId(args) {
  if (args[0].endsWith('run-tests.js')) return 'node:' + args.at(-1);
  if (args.includes('scripts/bench-workbench-overhead.js')) return 'performance:instrumentation';
  const prefix = ['editor-budgets', 'studio-large-file'].includes(args[1]) ? 'performance:' : 'browser:';
  return prefix + args[1];
}

function fixture(failures = new Map()) {
  const calls = [];
  const writes = [];
  let tick = 0;
  const invoke = async id => {
    calls.push(id);
    if (failures.has(id)) throw failures.get(id);
  };
  return { calls, writes, options: {
    stage: 'all', selectedEngine: 'firefox', outputDirectory: resolve('artifacts', 'qualification-fixture'),
    env: { QUALIFICATION_SOURCE_SHA: 'a'.repeat(40), QUALIFICATION_SOURCE_TREE: 'b'.repeat(40), GITHUB_RUN_ID: 'fixture-run' },
    runScope: async (_command, args) => invoke(invocationId(args)), runPerformance: async () => invoke('performance'),
    write: async (path, report) => writes.push({ path, report: structuredClone(report) }),
    now: () => new Date(tick++ * 1000).toISOString()
  } };
}

test('independent areas, browsers and performance all finish after earlier failures without downgrading them', async () => {
  const message = 'Browser API mismatch\nactual: dock.snapshot is not a function';
  const scope = fixture(new Map([
    ['node:A19', Object.assign(new Error('Node area failed'), { exitCode: 23 })],
    [browserIds[0], Object.assign(new TypeError(message), { code: 'API_MISMATCH', exitCode: 7 })],
    ['performance', new Error('Editor latency budget failed')]
  ]));
  const report = await qualify(scope.options);
  assert.deepEqual(scope.calls, allIds);
  assert.equal(report.status, 'failed');
  assert.equal(report.exitCode, 1);
  assert.deepEqual(report.counts, { selected: allIds.length, passed: allIds.length - 3, failed: 3 });
  assert.equal(report.scopes[0].exitCode, 23);
  assert.deepEqual(report.scopes[2].error, { name: 'TypeError', message, code: 'API_MISMATCH' });
  assert.equal(report.scopes[2].exitCode, 7);
  assert(report.scopes.every(result => ['passed', 'failed'].includes(result.status) && result.finishedAt));
  assert(scope.writes.some(({ report: saved }) => saved.scopes[0].status === 'failed' && saved.scopes[1].status === 'pending'));
  assert.deepEqual(scope.writes.at(-1).report, report);
  assert.equal(scope.writes.at(-1).path, resolve(scope.options.outputDirectory, 'qualification-summary.json'));
  assert.equal(report.sourceSha, scope.options.env.QUALIFICATION_SOURCE_SHA);
  assert.equal(report.sourceTree, scope.options.env.QUALIFICATION_SOURCE_TREE);
  assert.equal(report.workflowRunId, 'fixture-run');
});

test('stage selection runs only the selected scopes and preserves browser deadlines and capture-only results', async () => {
  const selections = [['node', allIds.slice(0, 2)], ['browser', browserIds], ['performance', performanceIds], ['all', allIds]];
  for (const [stage, expected] of selections) {
    const scope = fixture();
    scope.options.stage = stage;
    scope.options.runPerformance = async () => {
      scope.calls.push('performance');
      return { mode: 'capture', regressionVerdict: null };
    };
    const report = await qualify(scope.options);
    assert.deepEqual(scope.calls, expected);
    assert.equal(report.exitCode, 0);
    assert.equal(report.status, 'passed');
    assert.equal(scope.options.env.SHARPFORGE_BROWSER_ENGINE, 'firefox');
    for (const result of report.scopes.filter(result => result.phase === 'browser')) assert.equal(result.timeoutMs, 1_320_000);
    if (expected.includes('performance')) {
      const pipeline = report.scopes.find(result => result.id === 'performance');
      assert.equal(pipeline.assessment.regressionVerdict, null);
    }
  }
});

test('a scope settles and is checkpointed before the next independent scope starts', async () => {
  const scope = fixture();
  let release;
  let started;
  const blocked = new Promise(resolve => { release = resolve; });
  const firstStarted = new Promise(resolve => { started = resolve; });
  const order = [];
  scope.options.runScope = async (_command, args) => {
    const id = invocationId(args);
    order.push('start:' + id);
    if (id === 'node:A19') {
      started();
      await blocked;
    } else assert(scope.writes.some(({ report }) => report.scopes[0].status === 'passed'));
    order.push('end:' + id);
  };
  const pending = qualify({ ...scope.options, stage: 'node' });
  await firstStarted;
  assert.deepEqual(order, ['start:node:A19']);
  release();
  await pending;
  assert.deepEqual(order, ['start:node:A19', 'end:node:A19', 'start:node:A20', 'end:node:A20']);
});

test('setup errors remain fatal before any scope starts', async () => {
  const overrides = [{ stage: 'unknown' }, { selectedEngine: 'unknown' },
    { write: async () => { throw new Error('Storage unavailable'); } }];
  for (const override of overrides) {
    const scope = fixture();
    await assert.rejects(qualify({ ...scope.options, ...override }));
    assert.deepEqual(scope.calls, []);
    assert.deepEqual(scope.writes, []);
  }
});

test('a thrown error carrying exit zero remains a failed outcome and a nonzero aggregate', async () => {
  const scope = fixture(new Map([['node:A19', Object.assign(new Error('Rejected scope'), { exitCode: 0 })]]));
  const report = await qualify({ ...scope.options, stage: 'node' });
  assert.equal(report.scopes[0].status, 'failed');
  assert.equal(report.scopes[0].exitCode, 1);
  assert.equal(report.scopes[1].status, 'passed');
  assert.equal(report.exitCode, 1);
});
