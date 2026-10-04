import { GitError, checkCancelled } from './errors.js';
import { compilePathspec } from './ignore.js';
import { validateCheckoutPath } from './path-safety.js';
import { applyPatch, applySelectedLines } from './patch-apply.js';
import { hashObject } from './hash.js';
import { gitlinkPaths, gitlinkAncestor, readGitlinkState } from './gitlink-worktree.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Stage matching files into a new index snapshot; failures leave the active index untouched. */
export async function addPaths(repo, paths = ['.'], options = {}) {
  await repo.loadRules(options);
  const matches = compilePathspec(paths);
  const listed = new Set(await repo.worktree.list(options));
  const tracked = new Set(repo.index.entries.map(entry => entry.path));
  const candidates = new Set([...listed, ...tracked]);
  const gitlinks = gitlinkPaths(repo.index);
  const next = repo.index.clone();
  const changed = [];
  for (const path of candidates) {
    checkCancelled(options.signal);
    if (!matches(path) || gitlinkAncestor(path, gitlinks) || (options.update && !tracked.has(path))) continue;
    if (!tracked.has(path) && repo.ignore.test(path) && !options.force) continue;
    const previous = repo.index.get(path);
    if (previous?.skipWorktree && !options.sparse) continue;
    if (previous?.mode === 0o160000 && !listed.has(path)) {
      const state = await readGitlinkState(repo, previous, options);
      if (!state.oid) throw new GitError('Conflict', 'Submodule has no commit to stage', { path });
      next.set({ ...previous, oid: state.oid });
      changed.push(path);
      continue;
    }
    const file = listed.has(path) ? await repo.worktree.read(path, options) : null;
    const stages = [null, repo.index.get(path, 1), repo.index.get(path, 2), repo.index.get(path, 3)];
    if (stages.some(Boolean)) next.recordResolution(path, stages, { algorithm: repo.algorithm });
    next.remove(path);
    if (file) {
      const data = await repo.clean(path, file.data, options);
      const oid = await repo.odb.write('blob', options.intentToAdd ? new Uint8Array() : data, options);
      const mode = repo.config?.get('core.filemode') === false || repo.config?.get('core.filemode') === 'false'
        ? previous?.mode ?? file.mode : file.mode;
      next.set({ path, oid, mode, stage: 0, stat: file.stat, intentToAdd: !!options.intentToAdd });
    }
    changed.push(path);
  }
  if (!changed.length && !options.update && (Array.isArray(paths) ? paths : [paths]).some(path => path !== '.')) {
    throw new GitError('NotFound', 'Pathspec did not match any stageable files', { paths });
  }
  await repo.replaceIndex(next, options);
  return { paths: changed, index: next };
}

/** Remove tracked paths with Git-style worktree/index overwrite guards. */
export async function removePaths(repo, paths, options = {}) {
  const matches = compilePathspec(paths);
  const head = await repo.readTree('HEAD', options);
  const next = repo.index.clone();
  const selected = repo.index.entries.filter(entry => entry.stage === 0 && matches(entry.path));
  if (!selected.length) throw new GitError('NotFound', 'Pathspec does not match tracked files', { paths });
  for (const entry of selected) {
    const file = await repo.worktree.read(entry.path, options);
    const worktreeOid = file ? await hashObject('blob', await repo.clean(entry.path, file.data, options), { algorithm: repo.algorithm }) : null;
    const staged = head.get(entry.path)?.oid !== entry.oid;
    const modified = file && (worktreeOid !== entry.oid || file.mode !== entry.mode);
    if (!options.force && (options.cached ? staged && modified : staged || modified)) {
      throw new GitError('Conflict', 'Removing the path would discard changes', { path: entry.path });
    }
    next.remove(entry.path);
  }
  const snapshot = await repo.snapshot(selected.map(entry => entry.path));
  try {
    if (!options.cached) for (const entry of selected) await repo.worktree.remove(entry.path, options);
    await repo.replaceIndex(next, options);
  } catch (error) {
    await repo.restoreSnapshot(snapshot);
    throw error;
  }
  return { paths: selected.map(entry => entry.path) };
}

/** Move a tracked file/directory preserving its staged bytes and unstaged edits separately. */
export async function movePath(repo, source, destination, options = {}) {
  validateCheckoutPath(source);
  validateCheckoutPath(destination);
  const entries = repo.index.entries.filter(entry => entry.path === source || entry.path.startsWith(`${source}/`));
  if (!entries.length) throw new GitError('NotFound', 'Move source is not tracked', { source });
  const moves = entries.map(entry => ({ entry, target: destination + entry.path.slice(source.length) }));
  for (const move of moves) {
    if (!options.force && await repo.worktree.read(move.target, options)) throw new GitError('Conflict', 'Move destination exists', { path: move.target });
    move.file = await repo.worktree.read(move.entry.path, options);
    if (!move.file) throw new GitError('NotFound', 'Move source is missing', { path: move.entry.path });
  }
  const snapshot = await repo.snapshot(moves.flatMap(move => [move.entry.path, move.target]));
  const next = repo.index.clone();
  try {
    for (const move of moves) {
      await repo.worktree.write(move.target, move.file.data, { ...options, mode: move.file.mode });
      await repo.worktree.remove(move.entry.path, options);
      next.remove(move.entry.path);
      next.set({ ...move.entry, path: move.target });
    }
    await repo.replaceIndex(next, options);
  } catch (error) {
    await repo.restoreSnapshot(snapshot);
    throw error;
  }
  return { paths: moves.map(move => move.target) };
}

/** Reset selected index paths to a source tree without changing worktree content. */
export async function unstagePaths(repo, paths, { source = 'HEAD', ...options } = {}) {
  const tree = await repo.readTree(source, options);
  const matches = compilePathspec(paths);
  const next = repo.index.clone();
  for (const path of new Set([...next.entries.map(entry => entry.path), ...tree.keys()])) {
    if (!matches(path)) continue;
    next.remove(path);
    if (tree.has(path)) next.set({ ...tree.get(path), path, stage: 0 });
  }
  await repo.replaceIndex(next, options);
  return { paths: next.entries.filter(entry => matches(entry.path)).map(entry => entry.path) };
}

/** Stage/unstage exact hunks or selected line operations against the current index blob. */
export async function stagePatch(repo, path, patch, options = {}) {
  validateCheckoutPath(path);
  if (repo.index.unmerged.some(entry => entry.path === path)) throw new GitError('Conflict', 'Resolve conflict stages before partial staging', { path });
  const previous = repo.index.get(path);
  const original = previous ? decoder.decode((await repo.odb.read(previous.oid, options)).data) : '';
  let text;
  if (typeof patch === 'string' || Array.isArray(patch)) text = applyPatch(original, patch, options);
  else {
    const before = patch.before ?? original;
    const after = patch.after ?? decoder.decode((await repo.worktree.read(path, options))?.data ?? new Uint8Array());
    if (!options.reverse && before !== original) throw new GitError('Conflict', 'Partial staging base is stale', { path });
    if (options.reverse && after !== original) throw new GitError('Conflict', 'Partial unstaging base is stale', { path });
    text = applySelectedLines(before, after, { ...patch, ...options });
  }
  const data = encoder.encode(text);
  const oid = await repo.odb.write('blob', data, options);
  const file = await repo.worktree.read(path, options);
  const next = repo.index.clone();
  next.set({ path, stage: 0, oid, mode: previous?.mode ?? file?.mode ?? 0o100644 });
  await repo.replaceIndex(next, options);
  return { path, oid };
}
