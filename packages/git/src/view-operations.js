import { GitError, checkLimit } from './errors.js';
import { RemoteManager } from './remotes.js';
import { applySelectedLines } from './patch-apply.js';
import { hashObject } from './hash.js';
import { blamePage } from './view-blame.js';
import { fileVersion, versionSummary, prepareComparison, commitComparison, comparisonPage,
  comparisonDocuments, viewSession } from './view-data.js';

const encoder = new TextEncoder();

function visibleRemoteUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch { return '(unavailable remote URL)'; }
}

async function fileComparison(repo, params, context) {
  const session = viewSession(repo);
  const value = params.cacheKey ? session.get(params.cacheKey) : await prepareComparison(repo, params, context);
  if (params.path && value.path !== params.path) throw new GitError('Conflict', 'Comparison snapshot belongs to a different path');
  const key = params.cacheKey ?? session.remember(value);
  return comparisonPage(value, key, params);
}

async function checkedSelection(repo, params, context) {
  const current = await prepareComparison(repo, { path: params.path, staged: params.staged }, context);
  if (current.before.oid !== params.beforeOid || current.after.oid !== params.afterOid
    || current.before.mode !== params.beforeMode || current.after.mode !== params.afterMode) {
    throw new GitError('Conflict', 'The comparison changed; refresh before staging selected lines');
  }
  if (current.binary) throw new GitError('Unsupported', 'Binary files must be staged as complete files');
  let selectedLines = params.selectedLines;
  if (params.hunkStart !== undefined) {
    const hunk = current.hunks.find(item => item.start === params.hunkStart);
    if (!hunk) throw new GitError('Conflict', 'The selected hunk no longer exists');
    selectedLines = [];
    for (let index = hunk.start; index < hunk.end; index++) if (current.lines[index].type !== 'equal') selectedLines.push(index);
  }
  if (!Array.isArray(selectedLines) || !selectedLines.length) throw new GitError('Conflict', 'Select changed lines before staging');
  checkLimit(selectedLines.length, 1000000, 'Selected line count');
  for (const index of selectedLines) {
    checkLimit(index, current.lines.length - 1, 'Selected line index');
    if (current.lines[index].type === 'equal') throw new GitError('Conflict', 'Unchanged lines cannot be staged independently');
  }
  return { current, selectedLines };
}

async function stageComparison(repo, params, context) {
  const { current, selectedLines } = await checkedSelection(repo, params, context);
  return repo.stagePatch(params.path, { before: current.before.text, after: current.after.text, selectedLines },
    { ...context, reverse: !!params.staged });
}

async function revertComparison(repo, params, context) {
  if (params.staged) throw new GitError('Conflict', 'Unstage a hunk before discarding its worktree changes');
  const { current, selectedLines } = await checkedSelection(repo, params, context);
  const text = applySelectedLines(current.before.text, current.after.text, { selectedLines, reverse: true, signal: context.signal });
  const snapshot = await repo.snapshot([params.path]);
  const deleted = !current.before.exists && !text;
  try {
    if (deleted) await repo.worktree.remove(params.path, context);
    else await repo.worktree.write(params.path, await repo.smudge(params.path, encoder.encode(text), context),
      { ...context, mode: current.after.mode || current.before.mode });
  } catch (error) {
    await repo.restoreSnapshot(snapshot);
    throw error;
  }
  return { path: params.path, deleted, text };
}

async function conflictDetail(repo, params, context) {
  await repo.loadIndex(context);
  const entries = [1, 2, 3].map(stage => repo.index.get(params.path, stage));
  if (!entries.some(Boolean)) throw new GitError('NotFound', 'Path has no unresolved index stages', { path: params.path });
  const versions = [];
  for (const entry of entries) {
    const version = await fileVersion(repo, entry, context);
    versions.push({ ...versionSummary(version), text: version.text !== null && version.size <= 8 * 1024 * 1024 ? version.text : null });
  }
  const working = await fileVersion(repo, await repo.worktree.read(params.path, context), context);
  if (working.exists) working.oid = await hashObject('blob', working.data, { algorithm: repo.algorithm });
  return { path: params.path, base: versions[0], ours: versions[1], theirs: versions[2],
    working: { ...versionSummary(working), text: working.size <= 8 * 1024 * 1024 ? working.text : null },
    stagesKey: entries.map(entry => entry ? `${entry.mode}:${entry.oid}` : '-').join('|') };
}

async function resolveConflictChoice(repo, params, context) {
  const detail = await conflictDetail(repo, params, context);
  if (params.stagesKey !== detail.stagesKey) throw new GitError('Conflict', 'Conflict stages changed; reopen the conflict editor');
  if (params.workingOid !== detail.working.oid) throw new GitError('Conflict', 'The working file changed; reopen the conflict editor');
  if (!['ours', 'theirs', 'delete', 'edited'].includes(params.choice)) throw new GitError('Corrupt', 'Unknown conflict resolution choice');
  const stages = [null, repo.index.get(params.path, 1), repo.index.get(params.path, 2), repo.index.get(params.path, 3)];
  const selected = params.choice === 'ours' ? stages[2] : params.choice === 'theirs' ? stages[3] : null;
  const deleted = params.choice === 'delete' || (params.choice !== 'edited' && !selected);
  const snapshot = await repo.snapshot([params.path]);
  const next = repo.index.clone();
  next.recordResolution(params.path, stages, { algorithm: repo.algorithm });
  next.remove(params.path);
  let version = null;
  try {
    if (deleted) {
      if (!stages.some(entry => entry?.mode === 0o160000)) await repo.worktree.remove(params.path, context);
      await repo.replaceIndex(next, context);
    } else if (params.choice === 'edited') {
      if (typeof params.text !== 'string') throw new GitError('Corrupt', 'Edited conflict resolution requires text');
      checkLimit(params.text.length, 8 * 1024 * 1024, 'Conflict editor text');
      if (/^(?:<{7,} |={7,}$|>{7,} |\|{7,} )/mu.test(params.text)) throw new GitError('Conflict', 'Remove conflict markers before staging the resolution');
      const mode = stages[2]?.mode ?? stages[3]?.mode ?? 0o100644;
      await repo.worktree.write(params.path, encoder.encode(params.text), { ...context, mode });
      await repo.add([params.path], context);
      version = await fileVersion(repo, repo.index.get(params.path), context);
    } else {
      version = await fileVersion(repo, selected, context);
      if (selected.mode !== 0o160000) await repo.worktree.write(params.path, await repo.smudge(params.path, version.data, context),
        { ...context, mode: selected.mode });
      next.set({ ...selected, stage: 0, path: params.path });
      await repo.replaceIndex(next, context);
    }
  } catch (error) {
    await repo.restoreSnapshot(snapshot);
    throw error;
  }
  return { path: params.path, resolved: true, deleted, ...(version ? versionSummary(version) : {}),
    text: version?.text !== null && (version?.size ?? 0) <= 8 * 1024 * 1024 ? version?.text : undefined };
}

/** Paged worker-side data contracts shared by the real Studio panels and native UI-data tests. */
export const viewOperations = Object.freeze([
  { name: 'fileComparison', run: fileComparison },
  { name: 'historicalFileDiff', run: (repo, params, context) => fileComparison(repo, params, context) },
  { name: 'comparisonDocuments', run(repo, params) { return comparisonDocuments(viewSession(repo).get(params.cacheKey), params); } },
  { name: 'releaseViewData', run(repo, params) { viewSession(repo).release(params.cacheKey); return { released: true }; } },
  { name: 'stageComparisonSelection', mutates: true, run: stageComparison },
  { name: 'revertComparisonSelection', mutates: true, run: revertComparison },
  { name: 'commitDetail', async run(repo, params, context) {
    const compared = await commitComparison(repo, params, context);
    return { commit: compared.commit, parent: compared.parent, files: compared.records.map(record => ({ path: record.path,
      oldPath: record.oldPath, status: record.status, similarity: record.similarity, oldMode: record.oldMode, newMode: record.newMode,
      oldOid: record.oldOid, newOid: record.newOid })) };
  } },
  { name: 'repositoryTree', async run(repo, params, context) {
    const refs = await repo.refs.list('refs/', context);
    const head = await repo.refs.resolve('HEAD', context);
    checkLimit(refs.length, 100000, 'Repository view references');
    const branch = ref => ({ ...ref, current: ref.name === head.ref, upstream: repo.config.get(`branch.${ref.name.slice(11)}.merge`) });
    return { head, branches: refs.filter(ref => ref.name.startsWith('refs/heads/')).map(branch),
      tags: refs.filter(ref => ref.name.startsWith('refs/tags/')), remoteBranches: refs.filter(ref => ref.name.startsWith('refs/remotes/')),
      remotes: new RemoteManager(repo).list().map(remote => ({ name: remote.name, url: visibleRemoteUrl(remote.url) })) };
  } },
  { name: 'blamePage', run: blamePage },
  { name: 'conflictDetail', run: conflictDetail },
  { name: 'resolveConflictChoice', mutates: true, run: resolveConflictChoice }
]);
