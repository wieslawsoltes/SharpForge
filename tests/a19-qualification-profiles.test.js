import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { a5BaselineProfile, activateBaselineProfile } from '../scripts/project16-baseline-profiles.js';
import { resolveQualificationTrigger, qualificationEnvironment } from '../scripts/project16-trigger.js';
import { loadPerformanceBaselines } from '../scripts/project16-baselines.js';
import { qualify, performance } from '../scripts/project16-qualification.js';
import { compareEditorPerformance } from '../scripts/check-editor-perf.js';
import { distribution } from '../scripts/editor-benchmarks/common.js';
import { compareWorkbenchTraces } from './workbench-perf-budget.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const compatibleHost = { node: 'v24.21.0', platform: 'linux', arch: 'x64', cpu: 'AMD EPYC 7763 64-Core Processor' };

function requested({ runner = 'ubuntu', engine = 'chromium', stage = 'all', nonce = 'compare-a5-20261004-a6' } = {}) {
  const branch = `codex/project16/qualify-${runner}-${engine}-${stage}-${nonce}`;
  return resolveQualificationTrigger({ eventName: 'create', event: { ref_type: 'branch', ref: branch },
    ref: 'refs/heads/' + branch, sha, checkoutSha: sha,
    runnerOS: { ubuntu: 'Linux', windows: 'Windows', macos: 'macOS' }[runner] });
}

test('both permitted comparative stages require verification before baseline paths become active', async () => {
  for (const stage of ['all', 'performance']) {
    const request = requested({ stage });
    assert.equal(request.baselineProfile, 'a5');
    assert.equal(request.captureOnly, false);
    assert.equal(request.editorBaseline, '');
    assert.throws(() => qualificationEnvironment(request, tree), /must be verified/);
    const selected = await activateBaselineProfile(request, { root });
    assert.equal(selected.baselineProfileVerified, true);
    assert.equal(selected.editorBaseline, a5BaselineProfile.editor.path);
    assert.equal(selected.workbenchBaseline, a5BaselineProfile.workbench.path);
    assert.equal(selected.captureOnly, false);
    assert.equal(Object.isFrozen(selected), true);
    const output = qualificationEnvironment(selected, tree);
    assert(output.includes('QUALIFICATION_BASELINE_PROFILE=a5\n'));
    assert(output.includes('QUALIFICATION_CAPTURE_ONLY=false\n'));
    assert(output.includes(`SHARPFORGE_EDITOR_BASELINE=${a5BaselineProfile.editor.path}\n`));
  }
});

test('ordinary create nonces keep empty baselines and perform no profile file reads', async () => {
  const request = requested({ nonce: '20261004-a6' });
  const selected = await activateBaselineProfile(request, { root, read: () => assert.fail('No profile was requested') });
  assert.equal(selected, request);
  assert.equal(selected.baselineProfile, null);
  assert.equal(selected.captureOnly, true);
  assert.equal(selected.editorBaseline, '');
  assert.equal(selected.workbenchBaseline, '');
});

test('reserved profile requests reject other runners, engines and non-performance stages', () => {
  for (const runner of ['windows', 'macos']) assert.throws(() => requested({ runner }), /requires a create trigger/);
  for (const engine of ['firefox', 'webkit']) assert.throws(() => requested({ engine }), /requires a create trigger/);
  for (const stage of ['node', 'browser']) assert.throws(() => requested({ stage }), /requires a create trigger/);
});

test('unknown and malformed compare prefixes never fall back to capture-only', () => {
  for (const nonce of ['compare-a4-20261004-a6', 'compare-a5', 'compare-a5--nonce', 'compare-unknown-nonce']) {
    assert.throws(() => requested({ nonce }), /Unknown reviewed|Malformed comparative/);
  }
  assert.throws(() => requested({ nonce: 'compare-a5-' + 'x'.repeat(54) }), /Malformed Project16/);
});

test('each pinned report and source envelope rejects same-length altered bytes', async () => {
  for (const specification of [a5BaselineProfile.source, a5BaselineProfile.editor, a5BaselineProfile.workbench]) {
    const changedPath = resolve(root, specification.path);
    await assert.rejects(activateBaselineProfile(requested(), { root, read: async path => {
      const bytes = await readFile(path);
      if (path === changedPath) bytes[0] ^= 1;
      return bytes;
    } }), /SHA-256 changed/);
  }
});

test('missing and changed-size pinned files reject activation instead of dropping a baseline', async () => {
  for (const specification of [a5BaselineProfile.source, a5BaselineProfile.editor, a5BaselineProfile.workbench]) {
    const changedPath = resolve(root, specification.path);
    await assert.rejects(activateBaselineProfile(requested(), { root, inspect: async path => {
      if (path === changedPath) throw Object.assign(new Error('Pinned file is missing'), { code: 'ENOENT' });
      return stat(path);
    } }), { code: 'ENOENT' });
    await assert.rejects(activateBaselineProfile(requested(), { root, inspect: async path =>
      path === changedPath ? { isFile: () => true, size: specification.bytes + 1 } : stat(path) }), /size changed/);
  }
});

test('activation also rejects unsupported direct profile requests and manual-event substitution', async () => {
  await assert.rejects(activateBaselineProfile({ ...requested(), baselineProfile: 'unreviewed' }, { root }), /Unknown reviewed/);
  await assert.rejects(activateBaselineProfile({ ...requested(), eventName: 'workflow_dispatch' }, { root }), /requires a create trigger/);
});

test('pinned schemas activate independently of this machine; existing preflight rejects incompatible live hosts', async () => {
  const selected = await activateBaselineProfile(requested(), { root });
  const options = { root, engine: selected.engine, editorPath: selected.editorBaseline, workbenchPath: selected.workbenchBaseline };
  const loaded = await loadPerformanceBaselines({ ...options, host: compatibleHost });
  assert.equal(loaded.editor.report.rows.length, 25);
  assert.equal(loaded.workbench.report.samples.length, 126);
  for (const change of [{ cpu: 'different host' }, { node: 'v24.19.0' }, { platform: 'win32' }, { arch: 'arm64' }]) {
    await assert.rejects(loadPerformanceBaselines({ ...options, host: { ...compatibleHost, ...change } }), /environment mismatch/);
  }
});

test('performance host rejection remains an independent scope failure after other all-stage scopes', async () => {
  const selected = await activateBaselineProfile(requested(), { root });
  const calls = [];
  const env = { SHARPFORGE_EDITOR_BASELINE: selected.editorBaseline, SHARPFORGE_WORKBENCH_BASELINE: selected.workbenchBaseline };
  const report = await qualify({ stage: 'all', selectedEngine: 'chromium', outputDirectory: resolve(root, 'unused-profile-test-output'), env,
    write: async () => {}, runScope: async (_command, args) => { calls.push(args); },
    runPerformance: options => performance({ ...options, checkoutRoot: root,
      host: { ...compatibleHost, cpu: 'different host' }, runCapture: () => assert.fail('Mismatch must precede performance capture') }) });
  const failed = report.scopes.filter(scope => scope.status === 'failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].id, 'performance');
  assert.match(failed[0].error.message, /environment mismatch/);
  assert(report.scopes.filter(scope => scope.id !== 'performance').every(scope => scope.status === 'passed'));
  assert.equal(calls.length, report.scopes.length - 1);
  assert.equal(report.exitCode, 1);
});

test('the original comparators still reject changed browser versions, fixtures and relative regressions', async () => {
  const editor = JSON.parse(await readFile(resolve(root, a5BaselineProfile.editor.path), 'utf8'));
  const trace = JSON.parse(await readFile(resolve(root, a5BaselineProfile.workbench.path), 'utf8'));
  const otherBrowser = structuredClone(editor);
  otherBrowser.environment.browserVersion = 'other-version';
  assert.throws(() => compareEditorPerformance(editor, otherBrowser, { requireBrowser: true }), /environment changed/);
  const slowerEditor = structuredClone(editor);
  for (const row of slowerEditor.rows) {
    row.rawSamplesMs = row.rawSamplesMs.map(value => value * 2);
    Object.assign(row, distribution(row.rawSamplesMs));
  }
  assert.equal(compareEditorPerformance(editor, slowerEditor, { requireBrowser: true }).passed, false);
  const changedTrace = structuredClone(trace);
  changedTrace.environment.browserVersion = 'other-version';
  assert.throws(() => compareWorkbenchTraces(changedTrace, trace), /environment differs/);
  changedTrace.environment = structuredClone(trace.environment);
  changedTrace.fixture.sha256 = 'a'.repeat(64);
  assert.throws(() => compareWorkbenchTraces(changedTrace, trace), /fixture differs/);
  const slowerTrace = structuredClone(trace);
  for (const sample of slowerTrace.samples) sample.duration *= 2;
  for (const summary of slowerTrace.summary) for (const key of ['p50', 'p95', 'p99']) summary[key] *= 2;
  assert(compareWorkbenchTraces(slowerTrace, trace).length > 0);
});
