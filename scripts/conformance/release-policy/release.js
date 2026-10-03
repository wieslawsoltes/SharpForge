import { parseArgs } from 'node:util';
import { isMain, repository, commit } from '../supply/files.js';
import { run, git } from '../repro/common.js';
import { checkVersions } from './versions.js';
import { checkPolicy } from './check-policy.js';
import { github, repositoryPath } from './github.js';
import { requireEnvironment } from './environment.js';
import { releaseAssets, verifyReleaseProof, exactDraftAssets } from './release-assets.js';

export function authorizedWorkflow(env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'push'
      || env.GITHUB_REF !== 'refs/tags/' + env.GITHUB_REF_NAME || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '')) {
    throw new Error('Release mutations require the authorized tag workflow');
  }
}

export async function release({ mode, execute = false, root = repository, env = process.env, api, signal } = {}) {
  if (!['draft', 'publish', 'verify'].includes(mode)) throw new Error('Expected draft, publish or verify mode');
  const version = await checkVersions({ root, tag: env.GITHUB_REF_NAME, signal });
  const sourceCommit = commit(root);
  if (await git(root, ['rev-parse', '--verify', `refs/tags/${version.tag}^{commit}`], { signal }) !== sourceCommit) {
    throw new Error('Release tag and checkout commit differ');
  }
  await checkPolicy({ root, api, repositoryName: env.GITHUB_REPOSITORY, signal });
  await verifyReleaseProof({ root, repositoryName: env.GITHUB_REPOSITORY, sourceRef: env.GITHUB_REF, signal });
  const assets = await releaseAssets({ root });
  if (mode === 'verify' || !execute) return { mode, executed: false, sourceCommit, ...version, assets };
  authorizedWorkflow(env);
  const prefix = repositoryPath(env.GITHUB_REPOSITORY);
  await requireEnvironment({
    api, repository: env.GITHUB_REPOSITORY, runId: env.GITHUB_RUN_ID, actor: env.GITHUB_ACTOR,
    requireApproval: mode === 'publish',
  });
  const endpoint = `${prefix}/releases/tags/${encodeURIComponent(version.tag)}`;
  let draft;
  try { draft = await api(endpoint); } catch (error) { if (error.status !== 404) throw error; }
  if (!draft && mode === 'draft') {
    const args = ['release', 'create', version.tag, ...assets.map((asset) => asset.path),
      '--repo', env.GITHUB_REPOSITORY, '--target', sourceCommit, '--verify-tag', '--draft', '--generate-notes',
      '--title', 'SharpForge ' + version.tag];
    if (version.prerelease) args.push('--prerelease');
    await run('gh', args, { cwd: root, env, signal });
    draft = await api(endpoint);
  }
  exactDraftAssets(draft, assets, { ...version, commit: sourceCommit });
  if (mode === 'publish') {
    await api(`${prefix}/releases/${draft.id}`, { method: 'PATCH', body: { draft: false, prerelease: version.prerelease } });
  }
  return { mode, executed: true, sourceCommit, ...version, assets, releaseId: draft.id };
}

if (isMain(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { execute: { type: 'boolean', default: false } } });
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  console.log(JSON.stringify(await release({
    mode: positionals[0], execute: values.execute, api: github({ signal: controller.signal }), signal: controller.signal,
  }), null, 2));
}
