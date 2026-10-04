import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { mergeTrees } from './tree.js';
import { planCheckout, applyCheckout } from '../checkout.js';
import { createCommit } from '../commit.js';

async function virtualBase(repo, bases, options, depth = 0) {
  checkLimit(depth, 16, 'Recursive merge base depth');
  if (!bases.length) return new Map();
  let tree = await repo.readTree(bases[0], options);
  for (let index = 1; index < bases.length; index++) {
    const ancestors = await repo.graph.mergeBases(bases[index - 1], bases[index], options);
    const base = await virtualBase(repo, ancestors, options, depth + 1);
    const merged = await mergeTrees(repo, base, tree, await repo.readTree(bases[index], options), options);
    tree = merged.tree;
  }
  return tree;
}

/** Abort uses the persisted raw worktree/index snapshot, including preexisting unrelated edits. */
export async function abortMerge(repo) {
  const state = await repo.readState('merge');
  if (!state) throw new GitError('NotFound', 'No merge is in progress');
  const head = await repo.refs.read('HEAD');
  if (head !== state.original) throw new GitError('Conflict', 'HEAD moved outside the in-progress merge');
  await repo.restoreSnapshot(state.snapshot);
  await repo.deleteState('MERGE_HEAD');
  await repo.deleteState('MERGE_MSG');
  await repo.deleteState('merge');
  return { status: 'aborted', oid: state.original };
}

async function fastForward(repo, ours, theirs, options) {
  const plan = await planCheckout(repo, theirs, options);
  const snapshot = await applyCheckout(repo, plan, options);
  try {
    await repo.refs.update('ORIG_HEAD', ours, { expected: await repo.refs.read('ORIG_HEAD'), message: 'merge: save original HEAD' });
    await repo.refs.update('HEAD', theirs, { expected: ours, message: 'merge: Fast-forward' });
  } catch (error) {
    await repo.restoreSnapshot(snapshot);
    throw error;
  }
  return { status: 'fast-forward', oid: theirs, paths: plan.changes.map(change => change.path) };
}

/** Merge orchestration supporting ff-only, no-ff, squash, conflicts, continue and abort. */
export async function merge(repo, revision, options = {}) {
  if (options.abort || revision === '--abort') return abortMerge(repo);
  if (options.continue || revision === '--continue') {
    const state = await repo.readState('merge');
    if (!state) throw new GitError('NotFound', 'No merge is in progress');
    const commit = await createCommit(repo, { ...options, message: options.message ?? state.message });
    return { status: 'merged', ...commit };
  }
  checkCancelled(options.signal);
  if (await repo.readState('merge') || await repo.readState('sequencer') || await repo.readState('rebase')) {
    throw new GitError('Conflict', 'Finish the current repository operation before merging');
  }
  const ours = await repo.refs.read('HEAD');
  const theirs = await repo.revParse(revision, options);
  if (!ours || typeof theirs !== 'string') throw new GitError('Conflict', 'Merge requires two commit tips');
  if (await repo.graph.isAncestor(theirs, ours, options)) return { status: 'up-to-date', oid: ours };
  const canFastForward = await repo.graph.isAncestor(ours, theirs, options);
  if (canFastForward && !options.noFf && !options.squash) return fastForward(repo, ours, theirs, options);
  if (options.ffOnly) throw new GitError('Conflict', 'Merge cannot fast-forward');
  const bases = await repo.graph.mergeBases(ours, theirs, options);
  if (!bases.length && !options.allowUnrelatedHistories) throw new GitError('Conflict', 'Refusing to merge unrelated histories');
  await repo.loadRules(options);
  const base = await virtualBase(repo, bases, options);
  const merged = await mergeTrees(repo, base, await repo.readTree(ours, options), await repo.readTree(theirs, options), {
    ...options, style: options.style ?? repo.config.get('merge.conflictstyle', 'merge'), theirsLabel: revision
  });
  const plan = await planCheckout(repo, merged.tree, options);
  const changedPaths = new Set(plan.changes.map(change => change.path));
  const conflictedPaths = new Set(merged.conflicts.map(conflict => conflict.path));
  for (const entry of repo.index.entries) {
    if (!changedPaths.has(entry.path) && !conflictedPaths.has(entry.path)) merged.index.set(entry);
  }
  plan.next = merged.index;
  const snapshot = await repo.snapshot(plan.changes.map(change => change.path));
  const message = options.message ?? `Merge ${revision}\n`;
  const state = { original: ours, incoming: theirs, message, snapshot, squash: !!options.squash };
  await repo.writeState('merge', state);
  await repo.refs.update('ORIG_HEAD', ours, { expected: await repo.refs.read('ORIG_HEAD'), message: 'merge: save original HEAD' });
  if (!options.squash) await repo.writeState('MERGE_HEAD', { oids: [theirs] });
  await repo.writeState('MERGE_MSG', { message });
  try { await applyCheckout(repo, plan, options); }
  catch (error) {
    await repo.deleteState('merge');
    await repo.deleteState('MERGE_HEAD');
    await repo.deleteState('MERGE_MSG');
    throw error;
  }
  if (!merged.clean) return { status: 'conflicted', conflicts: merged.conflicts, bases };
  if (options.noCommit || options.squash) return { status: options.squash ? 'squashed' : 'ready', bases };
  const commit = await createCommit(repo, { ...options, message });
  return { status: 'merged', ...commit, bases };
}

export { mergeTrees } from './tree.js';
export { mergeText, mergeFile, diff3 } from './diff3.js';
