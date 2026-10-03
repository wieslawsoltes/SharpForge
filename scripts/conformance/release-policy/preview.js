import { appendFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { isMain } from '../supply/files.js';
import { inventory, writeJSON } from '../repro/common.js';
import { github, repositoryPath } from './github.js';

/** Artifact provenance describes an untrusted PR build; it is not release qualification. */
export async function recordPreview({ env = process.env, root = process.cwd(), signal } = {}) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request' || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '')
      || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? '') || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')
      || !/^[a-f0-9]{40}$/.test(env.PREVIEW_HEAD_SHA ?? '') || !/^\d+$/.test(env.PREVIEW_PR ?? '')) {
    throw new Error('Preview requires exact pull request and workflow run identity');
  }
  repositoryPath(env.GITHUB_REPOSITORY);
  signal?.throwIfAborted();
  const files = await inventory(root + '/dist');
  if (!files.length) throw new Error('Preview distribution is empty');
  const report = {
    schemaVersion: 1, repository: env.GITHUB_REPOSITORY, pullRequest: Number(env.PREVIEW_PR),
    runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    mergeCommit: env.GITHUB_SHA, headCommit: env.PREVIEW_HEAD_SHA, files,
    scope: 'Untrusted PR build artifact; do not execute in privileged workflows. No production deployment or release qualification.',
  };
  await writeJSON(root + '/artifacts/preview.json', report);
  return report;
}

export async function previewLink({ api, repository, runId, signal } = {}) {
  if (!/^\d+$/.test(String(runId))) throw new Error('Expected numeric CI run id');
  signal?.throwIfAborted();
  const prefix = repositoryPath(repository);
  const run = await api(`${prefix}/actions/runs/${runId}`);
  const workflow = await api(prefix + '/actions/workflows/ci.yml');
  if (run.id !== Number(runId) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1
      || run.workflow_id !== workflow.id || run.event !== 'pull_request' || run.conclusion !== 'success'
      || run.repository?.full_name !== repository) throw new Error('Preview needs a successful PR core run in this repository');
  const result = await api(`${prefix}/actions/runs/${runId}/artifacts?per_page=100`);
  if (!Array.isArray(result.artifacts) || result.total_count > 100) throw new Error('Preview artifact inventory exceeds bounds');
  const name = `preview-dist-${run.id}-${run.run_attempt}`;
  const matches = result.artifacts.filter((artifact) => artifact.name === name && artifact.expired === false);
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0]?.id) || matches[0].id < 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest ?? '')) {
    throw new Error('Missing, expired, duplicate or unsealed preview artifact');
  }
  return {
    repository, runId: run.id, headCommit: run.head_sha, digest: matches[0].digest,
    url: `https://github.com/${repository}/actions/runs/${run.id}/artifacts/${matches[0].id}`,
    scope: 'Download only. Artifact contents remain untrusted PR data and are never executed here.',
  };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { record: { type: 'boolean' }, 'run-id': { type: 'string' } } });
  const result = values.record ? await recordPreview() : await previewLink({
    api: github(), repository: process.env.GITHUB_REPOSITORY, runId: values['run-id'],
  });
  if (process.env.GITHUB_STEP_SUMMARY && result.url) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `[Download PR preview artifact](${result.url})\n\n${result.scope}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
}
