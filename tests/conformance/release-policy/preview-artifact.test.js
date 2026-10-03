import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { temporary } from '../../../scripts/conformance/repro/common.js';
import { recordPreview, previewLink } from '../../../scripts/conformance/release-policy/preview.js';

const env = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '1',
  GITHUB_SHA: 'a'.repeat(40), PREVIEW_HEAD_SHA: 'b'.repeat(40), PREVIEW_PR: '34', GITHUB_REPOSITORY: 'owned/fixture' };

test('existing PR dist artifact records exact merge/head commits and file hashes without deployment', async () => {
  await temporary(async (root) => {
    await mkdir(join(root, 'dist'));
    await assert.rejects(recordPreview({ root, env }), /empty/);
    await writeFile(join(root, 'dist/index.html'), '<title>Owned PR fixture</title>');
    const result = await recordPreview({ root, env });
    assert.equal(result.mergeCommit, env.GITHUB_SHA);
    assert.equal(result.headCommit, env.PREVIEW_HEAD_SHA);
    assert.equal(result.files.length, 1);
    assert.match(result.scope, /Untrusted PR/);
    await assert.rejects(recordPreview({ root, env: { ...env, GITHUB_EVENT_NAME: 'push' } }), /pull request/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(recordPreview({ root, env, signal: controller.signal }), { name: 'AbortError' });
  });
});

test('preview locator only returns sealed artifacts from the exact successful PR run, including forks as data', async () => {
  const run = { id: 12, run_attempt: 1, workflow_id: 7, event: 'pull_request', conclusion: 'success',
    repository: { full_name: 'owned/fixture' }, head_repository: { full_name: 'fork/fixture' }, head_sha: 'b'.repeat(40) };
  const artifacts = { total_count: 1, artifacts: [{ id: 8, name: 'preview-dist-12-1', expired: false, digest: 'sha256:' + 'a'.repeat(64) }] };
  const api = async (path, request) => {
    assert.equal(request, undefined, 'Locator never writes, downloads, extracts or executes PR data');
    if (path.includes('/workflows/')) return { id: 7 };
    if (path.includes('/artifacts?')) return artifacts;
    return run;
  };
  assert.equal((await previewLink({ api, repository: 'owned/fixture', runId: 12 })).url,
    'https://github.com/owned/fixture/actions/runs/12/artifacts/8');
  artifacts.artifacts[0].expired = true;
  await assert.rejects(previewLink({ api, repository: 'owned/fixture', runId: 12 }), /expired/);
  artifacts.artifacts[0].expired = false;
  run.conclusion = 'failure';
  await assert.rejects(previewLink({ api, repository: 'owned/fixture', runId: 12 }), /successful PR/);
  await assert.rejects(previewLink({ api, repository: 'owned/fixture', runId: '../other' }), /numeric/);
});
