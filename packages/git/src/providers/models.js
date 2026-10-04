import { GitError } from '../errors.js';
import { providerText } from './endpoints.js';

/** UI-facing provider records omit transport internals and never render server HTML. */
export function pullRequestRecord(value, provider, { sourceRemote, remote } = {}) {
  const sourceBranch = value.head?.ref ?? value.source_branch ?? value.source?.branch?.name ?? value.sourceRefName ?? value.sourceBranch;
  const targetBranch = value.base?.ref ?? value.target_branch ?? value.destination?.branch?.name ?? value.targetRefName ?? value.targetBranch;
  const sourceOid = value.head?.sha ?? value.diff_refs?.head_sha ?? value.sha ?? value.source?.commit?.hash ?? value.lastMergeSourceCommit?.commitId;
  const repositoryUrl = sourceRemote ?? value.head?.repo?.clone_url ?? value.source?.repository?.links?.html?.href ??
    (value.forkSource ? value.forkSource.repository?.remoteUrl : value.repository?.remoteUrl ?? (provider === 'azure' ? remote : undefined));
  const targetRemote = provider === 'azure' ? safeRepositoryUrl(value.repository?.webUrl ?? value.repository?.remoteUrl ?? remote) : null;
  const azureLink = targetRemote && Number.isSafeInteger(value.pullRequestId) && value.pullRequestId > 0 ?
    `${targetRemote.replace(/\/$/, '').replace(/\.git$/, '')}/pullrequest/${value.pullRequestId}` : null;
  return Object.freeze({
    id: value.number ?? value.iid ?? value.pullRequestId ?? value.id,
    title: String(value.title ?? ''), body: String(value.body ?? value.description ?? ''),
    state: String(value.state ?? value.status ?? 'open').toLowerCase(),
    url: safeDisplayUrl(value.html_url ?? value.web_url ?? value.links?.html?.href ?? value._links?.web?.href ?? azureLink),
    sourceBranch: typeof sourceBranch === 'string' ? sourceBranch.replace(/^refs\/heads\//, '') : null,
    targetBranch: typeof targetBranch === 'string' ? targetBranch.replace(/^refs\/heads\//, '') : null,
    sourceOid: typeof sourceOid === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sourceOid) ? sourceOid.toLowerCase() : null,
    sourceRemote: safeRepositoryUrl(repositoryUrl),
    draft: Boolean(value.draft ?? value.isDraft ?? value.work_in_progress), provider
  });
}

function safeRepositoryUrl(input) {
  const display = safeDisplayUrl(input);
  if (!display) return null;
  const url = new URL(display);
  return url.search || url.hash ? null : url.href;
}

export function issueRecord(value, provider) {
  return Object.freeze({ id: value.number ?? value.iid ?? value.id,
    title: String(value.title ?? value.fields?.['System.Title'] ?? ''),
    body: String(value.body ?? value.description ?? value.content?.raw ?? value.fields?.['System.Description'] ?? ''),
    state: String(value.state ?? value.fields?.['System.State'] ?? 'open').toLowerCase(),
    url: safeDisplayUrl(value.html_url ?? value.web_url ?? value.links?.html?.href ?? value._links?.html?.href), provider });
}

export function safeDisplayUrl(input) {
  if (!input) return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return url.href;
}

export function pullRequestInput(value) {
  const title = providerText(value.title, 'Pull request title', 1024);
  const head = providerText(value.head ?? value.sourceBranch, 'Source branch', 1024);
  const base = providerText(value.base ?? value.targetBranch, 'Target branch', 1024);
  if (!title.trim() || !head || !base || head === base) throw new GitError('Unsafe', 'PR needs a title and distinct source and target branches');
  return { title, head, base, body: providerText(value.body ?? '', 'Pull request body'), draft: Boolean(value.draft) };
}

export function issueInput(value) {
  const title = providerText(value.title, 'Issue title', 1024);
  if (!title.trim()) throw new GitError('Unsafe', 'Issue title cannot be empty');
  return { title, body: providerText(value.body ?? '', 'Issue body') };
}

export function textPatch(value, mapping) {
  return Object.fromEntries(Object.entries(mapping).filter(([key]) => value[key] !== undefined)
    .map(([key, target]) => [target, providerText(value[key], key)]));
}
