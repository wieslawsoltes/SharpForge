import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { qualify } from '../scripts/project16-qualification.js';
import { resolveQualificationTrigger, qualificationEnvironment } from '../scripts/project16-trigger.js';
import { activateBaselineProfile } from '../scripts/project16-baseline-profiles.js';

const sha = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const suite = 'workbench-workflows-standalone';
const platforms = [['ubuntu', 'Linux'], ['windows', 'Windows'], ['macos', 'macOS']];

function created(platform, engine, stage = 'standalone', nonce = '20261004-m2') {
  const branch = `codex/project16/qualify-${platform}-${engine}-${stage}-${nonce}`;
  return {
    eventName: 'create', event: { ref_type: 'branch', ref: branch }, ref: 'refs/heads/' + branch,
    sha, checkoutSha: sha, runnerOS: platforms.find(([name]) => name === platform)[1]
  };
}

function fixture(error) {
  const calls = [];
  const writes = [];
  let tick = 0;
  return { calls, writes, options: {
    stage: 'standalone', selectedEngine: 'webkit', outputDirectory: resolve('artifacts', 'standalone-stage-fixture'),
    env: { PYTHON: 'selected-python', QUALIFICATION_SOURCE_SHA: sha,
      QUALIFICATION_SOURCE_TREE: tree, GITHUB_RUN_ID: 'fixture-run' },
    runScope: async (...args) => { calls.push(args); if (error) throw error; },
    runPerformance: async () => assert.fail('Standalone must not invoke performance capture'),
    write: async (path, report) => writes.push({ path, report: structuredClone(report) }),
    now: () => new Date(tick++ * 1000).toISOString()
  } };
}

test('standalone create and manual selections retain platform, engine and immutable source', () => {
  for (const [platform, runnerOS] of platforms) for (const engine of ['chromium', 'firefox', 'webkit']) {
    const create = created(platform, engine);
    const dispatch = { eventName: 'workflow_dispatch',
      event: { inputs: { runner: platform + '-latest', engine, stage: 'standalone' } },
      ref: 'refs/heads/main', sha, checkoutSha: sha, runnerOS };
    for (const input of [create, dispatch]) {
      const selected = resolveQualificationTrigger(input);
      assert.equal(selected.runner, platform + '-latest');
      assert.equal(selected.engine, engine);
      assert.equal(selected.stage, 'standalone');
      assert.equal(selected.sha, sha);
      assert.equal(selected.ref, input.ref);
      assert.equal(selected.captureOnly, true);
      assert.equal(selected.baselineProfile, null);
      const environment = qualificationEnvironment(selected, tree);
      assert(environment.includes('QUALIFICATION_STAGE=standalone\n'));
      assert(environment.includes('QUALIFICATION_SOURCE_SHA=' + sha + '\n'));
      assert(environment.includes('QUALIFICATION_SOURCE_TREE=' + tree + '\n'));
    }
  }
});

test('standalone invokes only the existing supervised suite with its unchanged ID and deadline', async () => {
  const state = fixture();
  const report = await qualify(state.options);
  assert.deepEqual(state.calls, [['selected-python',
    ['tests/conformance/browser/run_suite.py', suite, '--timeout', '1200'], 1_320_000]]);
  assert.deepEqual(report.scopes.map(scope => [scope.id, scope.phase]), [['browser:' + suite, 'browser']]);
  assert.deepEqual(report.counts, { selected: 1, passed: 1, failed: 0 });
  assert.equal(report.status, 'passed');
  assert.equal(report.exitCode, 0);
  assert.equal(report.stage, 'standalone');
  assert.equal(report.engine, 'webkit');
  assert.equal(report.sourceSha, sha);
  assert.equal(report.sourceTree, tree);
  assert.equal(report.workflowRunId, 'fixture-run');
  assert.equal(state.options.env.SHARPFORGE_BROWSER_ENGINE, 'webkit');
  assert.deepEqual(state.writes.at(-1).report, report);
  assert.equal(state.writes.at(-1).path, resolve(state.options.outputDirectory, 'qualification-summary.json'));
});

test('standalone failure preserves original cause and source in every checkpoint without widening scope', async () => {
  const error = Object.assign(new Error('file navigation failed before initialization'), { exitCode: 7, code: 'NAVIGATION' });
  const state = fixture(error);
  const report = await qualify(state.options);
  assert.equal(state.calls.length, 1);
  assert.deepEqual(report.counts, { selected: 1, passed: 0, failed: 1 });
  assert.equal(report.status, 'failed');
  assert.equal(report.exitCode, 1);
  assert.equal(report.scopes[0].exitCode, 7);
  assert.deepEqual(report.scopes[0].error, { name: 'Error', message: error.message, code: 'NAVIGATION' });
  assert.deepEqual(state.writes.map(({ report: saved }) => saved.scopes[0].status), ['pending', 'running', 'failed', 'failed']);
  for (const { report: saved } of state.writes) {
    assert.equal(saved.sourceSha, sha);
    assert.equal(saved.sourceTree, tree);
    assert.deepEqual(saved.scopes.map(scope => scope.id), ['browser:' + suite]);
  }
  assert.deepEqual(state.writes.at(-1).report, report);
});

test('standalone cannot request compare-a5 even on Ubuntu Chromium; existing comparative stages remain accepted', () => {
  assert.throws(() => resolveQualificationTrigger(created('ubuntu', 'chromium', 'standalone', 'compare-a5-20261004-m2')),
    /requires a create trigger with ubuntu\/chromium and all or performance/);
  for (const stage of ['all', 'performance']) {
    const selected = resolveQualificationTrigger(created('ubuntu', 'chromium', stage, 'compare-a5-20261004-a6'));
    assert.equal(selected.baselineProfile, 'a5');
    assert.equal(selected.captureOnly, false);
  }
});

test('profile activation rejects a standalone selection before any baseline I/O', async () => {
  const selected = resolveQualificationTrigger(created('ubuntu', 'chromium'));
  await assert.rejects(activateBaselineProfile({ ...selected, baselineProfile: 'a5' }, {
    root: resolve('.'), read: async () => assert.fail('Rejected profile must not read a baseline'),
    inspect: async () => assert.fail('Rejected profile must not inspect a baseline')
  }), /requires a create trigger with ubuntu\/chromium and all or performance/);
});
