import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeCheckoutProvenance, requireNativeCheckout} from '../scripts/a05/native-provenance.js';

const localEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GITHUB_')));

async function repository(run) {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-a05-provenance-'));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', timeout: 10000}).trim();
  try {
    git('init', '--quiet');
    await writeFile(join(root, 'guest.cs'), 'class Program { static void Main() {} }\n');
    git('add', 'guest.cs');
    git('-c', 'user.name=A05 Fixture', '-c', 'user.email=a05@example.invalid', 'commit', '--quiet', '-m', 'fixture');
    await run(root, git);
  } finally { await rm(root, {recursive: true, force: true}); }
}

test('native provenance retains exact tree and generated SDK file while permitting untracked evidence', async () => {
  await repository(async (root, git) => {
    const sdk = '{"sdk":{"version":"8.0.425","rollForward":"disable"}}\n';
    await writeFile(join(root, 'global.json'), sdk);
    await writeFile(join(root, 'local-report.json'), '{}\n');
    const report = await nativeCheckoutProvenance({root, environment: localEnvironment});
    assert.equal(report.revision, git('rev-parse', 'HEAD'));
    assert.equal(report.tree, git('rev-parse', 'HEAD^{tree}'));
    assert.equal(report.cleanTrackedTree, true);
    assert.equal(report.trackedChanges, '');
    assert.deepEqual(report.globalJson, {path: 'global.json', present: true, tracked: false, content: sdk,
      sha256: createHash('sha256').update(sdk).digest('hex')});
    assert.doesNotThrow(() => requireNativeCheckout(report));
    assert.match(report.nativeRuntimeObservation, /does not identify the guest process runtime patch/);
  });
});

test('native provenance rejects unstaged and staged tracked edits before native work', async () => {
  await repository(async (root, git) => {
    await writeFile(join(root, 'guest.cs'), 'modified guest\n');
    for (const staged of [false, true]) {
      if (staged) git('add', 'guest.cs');
      const report = await nativeCheckoutProvenance({root, environment: localEnvironment});
      assert.equal(report.cleanTrackedTree, false);
      assert.match(report.trackedChanges, /guest\.cs/);
      assert.throws(() => requireNativeCheckout(report), /clean tracked checkout/);
    }
  });
});

test('native provenance records public workflow and PR identities without copying the event payload', async () => {
  await repository(async (root, git) => {
    const eventPath = join(root, 'event.json'), revision = git('rev-parse', 'HEAD');
    await writeFile(eventPath, JSON.stringify({number: 7, sender: {ignored: 'not copied'},
      pull_request: {number: 7, body: 'not copied', head: {sha: 'head-id', repo: {full_name: 'owner/fork'}},
        base: {sha: 'base-id', repo: {full_name: 'owner/repo'}}}}));
    const environment = {...localEnvironment, GITHUB_EVENT_PATH: eventPath, GITHUB_SHA: revision,
      GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2',
      GITHUB_REF: 'refs/pull/7/merge', GITHUB_HEAD_REF: 'feature', GITHUB_BASE_REF: 'main'};
    const report = await nativeCheckoutProvenance({root, environment});
    assert.equal(report.workflow.runId, '123');
    assert.equal(report.workflow.runAttempt, '2');
    assert.equal(report.workflow.eventName, 'pull_request');
    assert.equal(report.workflow.ref, 'refs/pull/7/merge');
    assert.deepEqual(report.workflow.pullRequest, {number: 7, headSha: 'head-id', baseSha: 'base-id',
      headRepository: 'owner/fork', baseRepository: 'owner/repo'});
    assert(!JSON.stringify(report.workflow).includes('not copied'));
    assert.doesNotThrow(() => requireNativeCheckout(report));
    assert.throws(() => requireNativeCheckout({...report, workflow: {...report.workflow, sha: 'different-id'}}), /GITHUB_SHA/);
  });
});
