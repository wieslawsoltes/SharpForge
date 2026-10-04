import { GitError } from './errors.js';
import { GitIndex } from './index-file.js';
import { indexTree } from './worktree-tree.js';
import { compilePathspec } from './ignore.js';
import { planCheckout, applyCheckout } from './checkout.js';
import { unstagePaths } from './stage.js';
import { validateSymlinkTarget } from './path-safety.js';

/** Soft/mixed/hard reset with ORIG_HEAD and a reflog recovery entry. */
export async function reset(repo, revision = 'HEAD', options = {}) {
  if (options.paths) return unstagePaths(repo, options.paths, { source: revision, ...options });
  const mode = options.mode ?? 'mixed';
  if (!['soft', 'mixed', 'hard'].includes(mode)) throw new GitError('Unsupported', 'Unsupported reset mode', { mode });
  if (mode === 'soft' && repo.index.unmerged.length) throw new GitError('Conflict', 'Cannot soft reset an unmerged index');
  const oid = await repo.revParse(revision, options);
  if (typeof oid !== 'string') throw new GitError('Corrupt', 'Reset requires one commit');
  await repo.readCommit(oid, options);
  const previous = await repo.refs.read('HEAD');
  let snapshot = null;
  if (mode === 'hard') {
    const plan = await planCheckout(repo, oid, { ...options, force: true, replaceAll: true });
    snapshot = await applyCheckout(repo, plan, options);
  } else if (mode === 'mixed') {
    snapshot = await repo.snapshot([]);
    const tree = await repo.readTree(oid, options);
    await repo.replaceIndex(new GitIndex({ version: repo.index.version, entries: [...tree].map(([path, entry]) => ({ ...entry, path, stage: 0 })) }), options);
  }
  try {
    if (previous) await repo.refs.update('ORIG_HEAD', previous, { expected: await repo.refs.read('ORIG_HEAD'), message: 'reset: save original HEAD' });
    await repo.refs.update('HEAD', oid, { expected: previous, message: `reset: moving to ${revision}` });
  } catch (error) {
    if (snapshot) await repo.restoreSnapshot(snapshot);
    throw error;
  }
  for (const name of ['MERGE_HEAD', 'MERGE_MSG', 'merge', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) await repo.deleteState(name);
  return { oid, previous, mode };
}

/** Restore selected worktree/index paths; conflict-stage selection does not mark them resolved. */
export async function restore(repo, paths, options = {}) {
  const matches = compilePathspec(paths);
  const stage = options.ours ? 2 : options.theirs ? 3 : 0;
  const source = options.source ? await repo.readTree(options.source, options) : options.staged
    ? await repo.readTree('HEAD', options) : new Map(repo.index.entries.filter(entry => entry.stage === stage).map(entry => [entry.path, entry]));
  const candidates = new Set([...source.keys(), ...repo.index.entries.map(entry => entry.path)]);
  const selected = [...candidates].filter(matches);
  const writes = [];
  const updateWorktree = options.worktree ?? !options.staged;
  if (updateWorktree) {
    for (const path of selected) {
      if (!options.force && ((options.dirtyPaths ?? []).includes(path) || (repo.dirtyBuffers && await repo.dirtyBuffers(path)))) {
        throw new GitError('Conflict', 'Restore would overwrite an unsaved editor buffer', { path });
      }
      const entry = source.get(path);
      const data = entry ? await repo.smudge(path, (await repo.odb.read(entry.oid, options)).data, options) : null;
      if (entry?.mode === 0o120000) validateSymlinkTarget(path, new TextDecoder().decode(data));
      writes.push({ path, entry, data });
    }
  }
  const snapshot = await repo.snapshot(updateWorktree ? selected : []);
  try {
    for (const item of writes.filter(item => !item.entry).sort((left, right) => right.path.length - left.path.length)) {
      await repo.worktree.remove(item.path, options);
    }
    for (const item of writes.filter(item => item.entry)) await repo.worktree.write(item.path, item.data, { ...options, mode: item.entry.mode });
    if (options.staged) {
      const next = repo.index.clone();
      for (const path of selected) {
        next.remove(path);
        if (source.has(path)) next.set({ ...source.get(path), path, stage: 0 });
      }
      await repo.replaceIndex(next, options);
    }
  } catch (error) {
    await repo.restoreSnapshot(snapshot);
    throw error;
  }
  return { paths: selected, staged: !!options.staged, worktree: updateWorktree };
}
