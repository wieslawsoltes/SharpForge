import { GitError } from './errors.js';
import { mergeTrees } from './merge/tree.js';
import { planCheckout, applyCheckout } from './checkout.js';
import { indexTree } from './worktree-tree.js';
import { peelRevision } from './revparse.js';

/** Reject tracked local changes before beginning an operation that must replay complete commits. */
export async function requireClean(repo, options = {}) {
  const records = await repo.status(options);
  const paths = records.filter(record => !['untracked', 'ignored'].includes(record.kind)).map(record => record.path);
  if (paths.length) throw new GitError('Conflict', 'Replay requires a clean tracked index and worktree', { paths });
}

/** Extend an original operation snapshot with newly touched paths without replacing earlier versions. */
export function extendSnapshot(snapshot, additional) {
  const paths = new Set(snapshot.files.map(file => file.path));
  for (const file of additional.files) if (!paths.has(file.path)) snapshot.files.push(file);
}

/** Compute one cherry-pick/revert merge and persist its pre-write snapshot through the caller. */
export async function applyCommitChange(repo, commit, options = {}) {
  commit = repo.graph.project(commit, await repo.graph.context(options));
  const mainline = options.mainline ?? (commit.parents.length > 1 ? null : 1);
  if (mainline === null || (commit.parents.length && (!Number.isInteger(mainline) || mainline < 1 || mainline > commit.parents.length))) {
    throw new GitError('Conflict', 'Replaying a merge commit requires a valid mainline parent', { oid: commit.oid });
  }
  const parent = commit.parents[mainline - 1];
  const parentTree = parent ? await repo.readTree(parent, options) : new Map();
  const commitTree = await repo.readTree(commit.oid, options);
  const ours = indexTree(repo.index);
  const base = options.revert ? commitTree : parentTree;
  const theirs = options.revert ? parentTree : commitTree;
  const merged = await mergeTrees(repo, base, ours, theirs, { ...options, theirsLabel: commit.oid.slice(0, 12) });
  const plan = await planCheckout(repo, merged.tree, { ...options, baseTree: ours });
  plan.next = merged.index;
  const snapshot = await repo.snapshot(plan.changes.map(change => change.path));
  await options.beforeWrite?.(snapshot);
  await applyCheckout(repo, plan, options);
  return { ...merged, snapshot };
}

/** Preserve explicit list order; replay ranges oldest first for cherry-pick and newest first for revert. */
export async function replayRevisions(repo, revisions, options = {}) {
  const result = [];
  for (const expression of Array.isArray(revisions) ? revisions : [revisions]) {
    const parsed = await repo.revParse(expression, options);
    if (typeof parsed === 'string') result.push(await peelRevision(repo, parsed, 'commit', options));
    else {
      const include = await Promise.all(parsed.include.map(oid => peelRevision(repo, oid, 'commit', options)));
      const exclude = await Promise.all(parsed.exclude.map(oid => peelRevision(repo, oid, 'commit', options)));
      const commits = await repo.graph.walk(include, { ...options, exclude });
      if (!options.revert) commits.reverse();
      result.push(...commits.map(commit => commit.oid));
    }
  }
  return result;
}
