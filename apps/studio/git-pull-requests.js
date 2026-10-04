import { GitError, checkCancelled, validateRefName } from '@sharpforge/git';
import { authorizeProviderTarget, providerTarget } from './git-provider-session.js';
import { withGitWorkspaceLoad, checkGitWorkspaceLoad } from './git-workspace-load.js';

const fullBranch = name => {
  if (typeof name !== 'string' || !name || name.startsWith('refs/') && !name.startsWith('refs/heads/')) {
    throw new GitError('Unsafe', 'Pull request source must be a branch');
  }
  const ref = name.startsWith('refs/heads/') ? name : `refs/heads/${name}`;
  validateRefName(ref);
  return ref;
};

function repositoryKey(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname.replace(/\/$/, '').replace(/\.git$/, '')}`;
}

/** Keep the server-created link across provider panel refreshes. */
export function rememberGitProviderCreation(workbench, identity, kind, result) {
  let url;
  try { url = new URL(result?.url); } catch { url = null; }
  if (url && (url.protocol !== 'https:' || url.username || url.password)) url = null;
  const created = { remote: identity.remote, provider: identity.provider, kind, id: result.id,
    title: String(result.title ?? ''), url: url?.href ?? null };
  workbench.lastProviderCreation = created;
  return created;
}

export async function currentGitPullRequestBranch(workbench, options = {}) {
  if (!workbench.repositoryId) throw new GitError('NotFound', 'Open a Git repository before creating a pull request from its branch');
  const head = await workbench.request('head', {}, options);
  checkCancelled(options.signal);
  if (!head.oid || !head.ref?.startsWith('refs/heads/')) {
    throw new GitError('Conflict', 'Check out a local branch before creating a pull request');
  }
  return fullBranch(head.ref).slice(11);
}

export async function readGitPullRequest(workbench, target, number, options = {}) {
  const identity = await authorizeProviderTarget(workbench, target, target.credentialId, options);
  const pullRequest = await workbench.request('git.provider', { ...identity,
    operation: 'getPullRequest', input: { number } }, options);
  checkCancelled(options.signal);
  return { identity, pullRequest };
}

/** Fetch a PR's actual fork branch, verify its advertised head, then create a normal tracking branch. */
export function checkoutGitPullRequest(workbench, target, number, { branch, ...options } = {}) {
  return withGitWorkspaceLoad(workbench.host, options, context => checkoutPullRequest(workbench, target, number, branch, context));
}

async function checkoutPullRequest(workbench, target, number, branch, options) {
  workbench.assertWorktreeChange?.();
  if (!workbench.repositoryId || !workbench.workspaceBound) {
    throw new GitError('Conflict', 'Open and bind a Git repository before checking out a pull request');
  }
  const repositoryId = workbench.repositoryId;
  const workspace = workbench.host.getWorkspaceIdentity();
  const assertCurrent = () => {
    checkGitWorkspaceLoad(options);
    workbench.assertWorktreeChange?.();
    if (repositoryId !== workbench.repositoryId || workspace !== workbench.host.getWorkspaceIdentity() || !workbench.workspaceBound) {
      throw new GitError('Conflict', 'The repository or workspace changed during pull request checkout');
    }
  };
  assertCurrent();
  const localRef = fullBranch(branch ?? `pr/${target.provider}-${number}`);
  const { pullRequest } = await readGitPullRequest(workbench, target, number, options);
  assertCurrent();
  if (!pullRequest.sourceRemote || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(pullRequest.sourceOid ?? '')) {
    throw new GitError('Unsupported', 'The provider did not identify an available source repository and commit for this pull request');
  }
  const sourceRef = fullBranch(pullRequest.sourceBranch);
  const source = providerTarget(pullRequest.sourceRemote, target.provider);
  // A fork on another origin resolves its own account. The target account never follows a returned URL.
  const sameOrigin = source.remoteId === new URL(target.remote).origin;
  const authorized = await authorizeProviderTarget(workbench, source, sameOrigin ? target.credentialId : undefined, options);
  assertCurrent();
  if (authorized.credentialId) workbench.credentialIds.set(source.remoteId, authorized.credentialId);
  const remotes = await workbench.request('remotes', {}, options);
  assertCurrent();
  const existing = remotes.find(remote => repositoryKey(remote.url) === repositoryKey(source.remote));
  const names = new Set(remotes.map(remote => remote.name));
  let name = existing?.name ?? `pr-${target.provider}-${number}`;
  for (let suffix = 2; !existing && names.has(name); suffix++) name = `pr-${target.provider}-${number}-${suffix}`;
  const trackingRef = `refs/remotes/${name}/${sourceRef.slice(11)}`;
  validateRefName(trackingRef);
  const network = await workbench.preferences.networkParameters({ name, url: source.remote, provider: source.provider },
    { signal: options.signal, anonymous: !authorized.credentialId });
  assertCurrent();
  await workbench.synchronize(options);
  assertCurrent();
  const initialHead = await workbench.request('head', {}, options);
  if (!existing) await workbench.request('changeRemote', { action: 'add', name, url: source.remote }, options);
  assertCurrent();
  await workbench.request('fetch', { ...network, repositoryId, credentialId: authorized.credentialId,
    anonymous: !authorized.credentialId, remoteName: name, refspecs: [`+${sourceRef}:${trackingRef}`] }, options);
  assertCurrent();
  const fetched = await workbench.request('revParse', { revision: trackingRef }, options);
  if (fetched !== pullRequest.sourceOid) {
    throw new GitError('Conflict', 'The source branch changed while fetching. Refresh this pull request before checking it out');
  }
  const currentHead = await workbench.request('head', {}, options);
  if (currentHead.ref !== initialHead.ref || currentHead.oid !== initialHead.oid) {
    throw new GitError('Conflict', 'The local HEAD changed while fetching this pull request');
  }
  assertCurrent();
  await workbench.synchronize(options);
  assertCurrent();
  // Existing branches are never reset. A failed later checkout leaves this recoverable named branch intact.
  await workbench.request('branch', { name: localRef, start: fetched, upstream: { remote: name, merge: sourceRef } }, options);
  assertCurrent();
  await workbench.request('checkout', { revision: localRef, dirtyPaths: [...(workbench.host.getState().dirtyFiles ?? [])] }, options);
  assertCurrent();
  await workbench.adoptRepository(options);
  return { branch: localRef, remote: name, trackingRef, oid: fetched, pullRequest };
}
