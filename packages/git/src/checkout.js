import { GitError, checkCancelled, checkLimit } from './errors.js';
import { GitIndex } from './index-file.js';
import { hashObject } from './hash.js';
import { validateCheckoutPaths, validateSymlinkTarget } from './path-safety.js';
import { gitlinkPaths, gitlinkAncestor } from './gitlink-worktree.js';

function sameEntry(left, right) {
  return left?.oid === right?.oid && left?.mode === right?.mode;
}

async function fileEntry(repo, path, options) {
  const file = await repo.worktree.read(path, options);
  if (!file) return null;
  const data = await repo.clean(path, file.data, options);
  return { ...file, oid: await hashObject('blob', data, { algorithm: repo.algorithm }) };
}

/** Preflight a two-tree switch including staged, unstaged, untracked and unsaved editor changes. */
export async function planCheckout(repo, target, options = {}) {
  const head = options.baseTree ?? await repo.readTree('HEAD', options);
  const tree = target instanceof Map ? target : await repo.readTree(target, options);
  checkLimit(tree.size, options.maxEntries ?? repo.maxEntries ?? 1000000, 'Checkout target entries');
  validateCheckoutPaths(tree.keys(), { caseSensitive: repo.worktree.caseSensitive !== false });
  if (repo.index.unmerged.length && !options.force) throw new GitError('Conflict', 'Cannot switch with unresolved index stages');
  const next = options.replaceAll ? new GitIndex({ version: repo.index.version }) : repo.index.clone();
  const changes = [];
  const conflicts = [];
  const currentPaths = new Set(await repo.worktree.list(options));
  const gitlinks = gitlinkPaths(repo.index);
  const targetDirectories = new Set();
  for (const path of tree.keys()) {
    let parent = path;
    while (parent.includes('/')) {
      parent = parent.slice(0, parent.lastIndexOf('/'));
      targetDirectories.add(parent);
    }
  }
  for (const path of currentPaths) {
    if (head.has(path) || repo.index.get(path)) continue;
    let blocked = tree.has(path) && tree.get(path).mode !== 0o160000 || targetDirectories.has(path);
    let parent = path;
    while (!blocked && parent.includes('/')) {
      parent = parent.slice(0, parent.lastIndexOf('/'));
      blocked = tree.has(parent) && tree.get(parent).mode !== 0o160000;
    }
    if (!blocked) continue;
    if (!options.force || gitlinkAncestor(path, gitlinks)) conflicts.push(path);
    else if (!tree.has(path)) changes.push({ path, after: null, data: null });
  }
  const dirtyPaths = new Set(options.dirtyPaths ?? []);
  const paths = new Set([...head.keys(), ...tree.keys(), ...repo.index.entries.map(entry => entry.path)]);
  for (const path of paths) {
    checkCancelled(options.signal);
    const before = head.get(path);
    const after = tree.get(path);
    const indexed = repo.index.get(path);
    if (!options.force && !options.replaceAll && sameEntry(before, after)) continue;
    if (indexed?.mode === 0o160000 && !currentPaths.has(path) && (!after || after.mode === 0o160000)) {
      if (!options.force && !sameEntry(indexed, before) && !sameEntry(indexed, after)) conflicts.push(path);
      else {
        next.remove(path);
        if (after) next.set({ ...after, path, stage: 0 });
      }
      continue;
    }
    const worktree = currentPaths.has(path) ? await fileEntry(repo, path, options) : null;
    const dirty = dirtyPaths.has(path) || (repo.dirtyBuffers && await repo.dirtyBuffers(path));
    if (!options.force && (dirty || (!sameEntry(indexed, before) && !sameEntry(indexed, after))
      || (!sameEntry(worktree, indexed) && !sameEntry(worktree, after)))) {
      conflicts.push(path);
      continue;
    }
    if (after?.mode === 0o160000) {
      next.remove(path);
      next.set({ ...after, path, stage: 0 });
      continue;
    }
    if (after && repo.worktree.supportedModes && !repo.worktree.supportedModes.includes(after.mode)) {
      throw new GitError('Unsupported', 'Worktree adapter cannot preserve this file mode', { path, mode: after.mode });
    }
    next.remove(path);
    if (after) next.set({ ...after, path, stage: 0 });
    changes.push({ path, after, data: null });
  }
  if (conflicts.length) throw new GitError('Conflict', 'Checkout would overwrite local changes', { paths: conflicts.sort() });
  await materializeChanges(repo, changes, options);
  return { tree, next, changes };
}

/** Batch promised blobs only after every dirty-buffer, overwrite, path and mode guard has succeeded. */
async function materializeChanges(repo, changes, options) {
  const oids = [...new Set(changes.filter(change => change.after).map(change => change.after.oid))];
  checkCancelled(options.signal);
  if (oids.length && repo.odb.prefetch) await repo.odb.prefetch(oids, options);
  for (const change of changes) {
    if (!change.after) continue;
    checkCancelled(options.signal);
    const object = await repo.odb.read(change.after.oid, options);
    if (object.type !== 'blob') throw new GitError('Corrupt', 'Checkout file references a non-blob', { path: change.path });
    change.data = await repo.smudge(change.path, object.data, options);
    if (change.after.mode === 0o120000) validateSymlinkTarget(change.path, new TextDecoder().decode(change.data));
  }
}

/** Apply an already-preflighted plan with a recoverable snapshot on every failure. */
export async function applyCheckout(repo, plan, options = {}) {
  const snapshot = await repo.snapshot(plan.changes.map(change => change.path));
  try {
    const removals = plan.changes.filter(change => !change.after).sort((left, right) => right.path.length - left.path.length);
    for (const change of removals) await repo.worktree.remove(change.path, options);
    for (const change of plan.changes) {
      if (change.after) await repo.worktree.write(change.path, change.data, { ...options, mode: change.after.mode });
    }
    await repo.replaceIndex(plan.next, options);
    repo.statCache.clear();
  } catch (error) {
    await repo.restoreSnapshot(snapshot);
    throw error;
  }
  return snapshot;
}

/** Switch a branch or detach HEAD only after all tree and editor-buffer guards pass. */
export async function checkout(repo, revision, options = {}) {
  await repo.loadRules(options);
  const oid = await repo.revParse(revision, options);
  if (typeof oid !== 'string') throw new GitError('Corrupt', 'Checkout requires one revision');
  const branch = revision.startsWith('refs/heads/') ? revision : `refs/heads/${revision}`;
  let branchOid = null;
  try { branchOid = await repo.refs.read(branch); } catch (error) { if (error.code !== 'Unsafe') throw error; }
  const rawHead = await repo.refs.read('HEAD', { deref: false });
  const plan = await planCheckout(repo, oid, options);
  const snapshot = await applyCheckout(repo, plan, options);
  try {
    const message = `checkout: moving from ${rawHead ?? '(unborn)'} to ${revision}`;
    if (branchOid === oid && !options.detach) await repo.refs.setSymbolic('HEAD', branch, { expected: rawHead, message });
    else await repo.refs.update('HEAD', oid, { deref: false, expected: rawHead, message });
  } catch (error) {
    await repo.restoreSnapshot(snapshot);
    throw error;
  }
  return { oid, branch: branchOid === oid && !options.detach ? branch : null, paths: plan.changes.map(change => change.path) };
}
