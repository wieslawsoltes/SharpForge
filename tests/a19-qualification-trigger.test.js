import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveQualificationTrigger, qualificationEnvironment, resolveTriggerEnvironment } from '../scripts/project16-trigger.js';

const sha = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const platforms = [['ubuntu', 'Linux'], ['windows', 'Windows'], ['macos', 'macOS']];

function created(branch = 'codex/project16/qualify-ubuntu-chromium-node-20261004a', overrides = {}) {
  return {
    eventName: 'create', event: { ref_type: 'branch', ref: branch },
    ref: 'refs/heads/' + branch, sha, checkoutSha: sha, runnerOS: 'Linux', ...overrides
  };
}

function manual(inputs = {}, overrides = {}) {
  return {
    eventName: 'workflow_dispatch', event: { inputs }, ref: 'refs/heads/main',
    sha, checkoutSha: sha, runnerOS: 'Linux', ...overrides
  };
}

test('each explicit platform, engine and stage resolves without running a capture', () => {
  for (const [platform, runnerOS] of platforms) for (const engine of ['chromium', 'firefox', 'webkit']) {
    for (const stage of ['all', 'node', 'browser', 'performance']) {
      const branch = `codex/project16/qualify-${platform}-${engine}-${stage}-20261004-a1`;
      const result = resolveQualificationTrigger(created(branch, { runnerOS }));
      assert.equal(result.runner, platform + '-latest');
      assert.equal(result.engine, engine);
      assert.equal(result.stage, stage);
      assert.equal(result.nonce, '20261004-a1');
      assert.equal(result.sha, sha);
      assert.equal(result.ref, 'refs/heads/' + branch);
      assert.equal(result.captureOnly, true);
    }
  }
});

test('default create events discard baseline and dispatch-style overrides', () => {
  const input = created();
  input.event.inputs = { runner: 'macos-latest', engine: 'webkit', stage: 'performance',
    editor_baseline: 'reviewed/editor.json', workbench_baseline: 'reviewed/workbench.json' };
  const result = resolveQualificationTrigger(input);
  assert.equal(result.runner, 'ubuntu-latest');
  assert.equal(result.engine, 'chromium');
  assert.equal(result.stage, 'node');
  assert.equal(result.editorBaseline, '');
  assert.equal(result.workbenchBaseline, '');
  assert.equal(result.captureOnly, true);
});

test('manual dispatch preserves defaults and exact supplied baseline paths', () => {
  const defaults = resolveQualificationTrigger(manual());
  assert.equal(defaults.runner, 'ubuntu-latest');
  assert.equal(defaults.engine, 'chromium');
  assert.equal(defaults.stage, 'all');
  assert.equal(defaults.captureOnly, true);
  const selected = resolveQualificationTrigger(manual({ runner: 'windows-latest', engine: 'firefox', stage: 'performance',
    editor_baseline: 'docs/baselines/editor with spaces.json', workbench_baseline: 'docs/baselines/比較.json'
  }, { runnerOS: 'Windows' }));
  assert.equal(selected.editorBaseline, 'docs/baselines/editor with spaces.json');
  assert.equal(selected.workbenchBaseline, 'docs/baselines/比較.json');
  assert.equal(selected.captureOnly, false);
  assert.equal(selected.nonce, '');
});

test('unrelated creates, tag creates and unsupported event types cannot qualify', () => {
  assert.throws(() => resolveQualificationTrigger(created('feature/ordinary-work')), /explicitly named/);
  const tag = created();
  tag.event.ref_type = 'tag';
  assert.throws(() => resolveQualificationTrigger(tag), /explicitly named/);
  for (const eventName of ['push', 'pull_request', 'delete', 'repository_dispatch']) {
    assert.throws(() => resolveQualificationTrigger(created(undefined, { eventName })), /Only workflow_dispatch/);
  }
});

test('the complete branch grammar rejects malformed selection and unsafe or oversized nonces', () => {
  const invalid = [
    'linux-chromium-node-20261004a', 'ubuntu-edge-node-20261004a', 'ubuntu-chromium-build-20261004a',
    'ubuntu-chromium-node-short', 'ubuntu-chromium-node-20261004A', 'ubuntu-chromium-node--20261004',
    'ubuntu-chromium-node-20261004-', 'ubuntu-chromium-node-' + 'x'.repeat(65),
    'ubuntu-chromium-node-2026/1004', 'ubuntu-chromium-node-20261004\nGITHUB_ENV=bad'
  ];
  for (const suffix of invalid) {
    assert.throws(() => resolveQualificationTrigger(created('codex/project16/qualify-' + suffix)), /branch|ref|control/);
  }
});

test('event and full ref identity must agree for created and manually selected refs', () => {
  assert.throws(() => resolveQualificationTrigger(created(undefined, { ref: 'refs/heads/main' })), /does not match/);
  const dispatch = manual();
  dispatch.event.ref = 'other-branch';
  assert.throws(() => resolveQualificationTrigger(dispatch), /does not match/);
  dispatch.event.ref = 'main';
  assert.equal(resolveQualificationTrigger(dispatch).ref, 'refs/heads/main');
  dispatch.event.ref = 'refs/heads/main';
  assert.equal(resolveQualificationTrigger(dispatch).ref, 'refs/heads/main');
  for (const ref of ['main', 'refs/heads/', 'refs/pull/1/merge', 'refs/heads/a..b', 'refs/heads/a.lock']) {
    assert.throws(() => resolveQualificationTrigger(manual({}, { ref })), /ref/);
  }
});

test('a mutable name, missing SHA or different checked-out commit cannot pass immutable source validation', () => {
  for (const invalid of ['', 'main', 'refs/heads/main', 'a'.repeat(39), 'a'.repeat(41), '0'.repeat(40), 'A'.repeat(40)]) {
    assert.throws(() => resolveQualificationTrigger(created(undefined, { sha: invalid })), /immutable/);
    assert.throws(() => resolveQualificationTrigger(created(undefined, { checkoutSha: invalid })), /immutable/);
  }
  assert.throws(() => resolveQualificationTrigger(created(undefined, { checkoutSha: 'c'.repeat(40) })), /does not match/);
});

test('allocated runner and manual choice values are validated before output', () => {
  assert.throws(() => resolveQualificationTrigger(created(undefined, { runnerOS: 'Windows' })), /Allocated runner/);
  for (const [key, value] of [['runner', 'self-hosted'], ['runner', ''], ['engine', 'edge'], ['stage', 'build']]) {
    assert.throws(() => resolveQualificationTrigger(manual({ [key]: value })), /Unsupported/);
  }
  assert.throws(() => resolveQualificationTrigger(manual({}, { event: { inputs: [] } })), /inputs/);
});

test('baseline data cannot inject Actions environment records', () => {
  for (const value of ['baseline.json\nQUALIFICATION_STAGE=all', 'a\rb', 'a\0b', 'a'.repeat(4097), 42]) {
    assert.throws(() => resolveQualificationTrigger(manual({ editor_baseline: value })), /bounded text/);
    assert.throws(() => resolveQualificationTrigger(manual({ workbench_baseline: value })), /bounded text/);
  }
  const selected = resolveQualificationTrigger(manual({ editor_baseline: 'docs/editor baseline.json' }));
  const output = qualificationEnvironment(selected, tree);
  assert.equal(output.split('\n').length, 13);
  assert(output.includes('QUALIFICATION_BASELINE_PROFILE=\n'));
  assert(output.includes('QUALIFICATION_SOURCE_SHA=' + sha + '\n'));
  assert(output.includes('QUALIFICATION_SOURCE_TREE=' + tree + '\n'));
  assert(output.includes('SHARPFORGE_EDITOR_BASELINE=docs/editor baseline.json\n'));
  assert.throws(() => qualificationEnvironment({ ...selected, editorBaseline: 'x\nINJECTED=yes' }, tree), /bounded text/);
  assert.throws(() => qualificationEnvironment(selected, 'main'), /immutable/);
});

test('oversized or malformed event files fail before writing any Actions environment output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-trigger-'));
  const eventPath = join(directory, 'event.json');
  const environmentPath = join(directory, 'environment.txt');
  try {
    await writeFile(environmentPath, 'EXISTING=value\n');
    const env = { GITHUB_EVENT_PATH: eventPath, GITHUB_ENV: environmentPath, GITHUB_WORKSPACE: join(directory, 'no-checkout') };
    await writeFile(eventPath, 'x'.repeat(256 * 1024 + 1));
    await assert.rejects(resolveTriggerEnvironment(env), /256 KiB/);
    assert.equal(await readFile(environmentPath, 'utf8'), 'EXISTING=value\n');
    await writeFile(eventPath, '{invalid');
    await assert.rejects(resolveTriggerEnvironment(env), SyntaxError);
    assert.equal(await readFile(environmentPath, 'utf8'), 'EXISTING=value\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
