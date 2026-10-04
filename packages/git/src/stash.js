import { GitError } from './errors.js';
import { GitIndex } from './index-file.js';
import { encodeCommit } from './objects.js';
import { commitIdentity } from './commit.js';
import { indexTree, writeTree } from './worktree-tree.js';
import { worktreeTree } from './status.js';
import { mergeTrees } from './merge/tree.js';
import { planCheckout, applyCheckout } from './checkout.js';
import { serializeReflogEntry } from './refs.js';

const encoder = new TextEncoder();

async function writeSnapshotCommit(repo, tree, parents, message, options) {
  const identity = commitIdentity(repo, options.author ?? options.committer, options);
  return repo.odb.write('commit', encodeCommit({ tree, parents, author: identity, committer: identity, message },
    { algorithm: repo.algorithm }), options);
}

async function treeFromMap(repo, entries, options) {
  return writeTree(repo, { ...options, index: new GitIndex({ entries: [...entries].map(([path, entry]) => ({ ...entry, path, stage: 0 })) }) });
}

async function storedWorktree(repo, options) {
  const files = await worktreeTree(repo, options);
  for (const entry of files.values()) if (entry.data) await repo.odb.write('blob', entry.data, options);
  return files;
}

async function push(repo, options) {
  const head = await repo.refs.read('HEAD');
  if (!head) throw new GitError('Conflict', 'Cannot stash before the first commit');
  if (repo.index.unmerged.length) throw new GitError('Conflict', 'Cannot stash an unmerged index');
  const records = await repo.status({ ...options, ignored: options.all });
  const includeUntracked = options.includeUntracked || options.all;
  if (!records.some(record => includeUntracked || !['untracked', 'ignored'].includes(record.kind))) return { status: 'empty' };
  const commit = await repo.readCommit(head, options);
  const rawHead = await repo.refs.read('HEAD', { deref: false });
  const branch = rawHead?.startsWith('refs/heads/') ? rawHead.slice(11) : '(no branch)';
  const description = options.message ?? `${head.slice(0, 7)} ${commit.message.split('\n')[0]}`;
  const staged = indexTree(repo.index);
  const indexCommit = await writeSnapshotCommit(repo, await treeFromMap(repo, staged, options), [head], `index on ${branch}: ${description}\n`, options);
  const working = await storedWorktree(repo, options);
  const tracked = new Map();
  const untracked = new Map();
  const headTree = await repo.readTree(head, options);
  for (const [path, entry] of working) {
    if (staged.has(path) || headTree.has(path)) tracked.set(path, entry);
    else if (includeUntracked && (options.all || !repo.ignore.test(path))) untracked.set(path, entry);
  }
  const parents = [head, indexCommit];
  if (untracked.size) {
    const tree = await treeFromMap(repo, untracked, options);
    parents.push(await writeSnapshotCommit(repo, tree, [], `untracked files on ${branch}: ${description}\n`, options));
  }
  const message = `WIP on ${branch}: ${description}\n`;
  const oid = await writeSnapshotCommit(repo, await treeFromMap(repo, tracked, options), parents, message, options);
  const previous = await repo.refs.read('refs/stash');
  await repo.refs.update('refs/stash', oid, { expected: previous, identity: commitIdentity(repo, options.committer, options), message: message.trimEnd() });
  const target = options.keepIndex ? staged : headTree;
  const plan = await planCheckout(repo, target, { ...options, force: true, replaceAll: true });
  const snapshot = await repo.snapshot([...plan.changes.map(change => change.path), ...untracked.keys()]);
  try {
    await applyCheckout(repo, plan, options);
    for (const path of untracked.keys()) await repo.worktree.remove(path, options);
  } catch (error) {
    await repo.restoreSnapshot(snapshot);
    throw error;
  }
  return { status: 'saved', oid, parents, message };
}

async function list(repo, options) {
  const entries = await repo.refs.reflog('refs/stash', options);
  return entries.slice().reverse().map((entry, index) => ({ index, ref: `stash@{${index}}`, oid: entry.newOid,
    message: entry.message, identity: entry.identity }));
}

async function select(repo, options) {
  if (options.oid) return { oid: await repo.revParse(options.oid, options), index: null };
  const entries = await list(repo, options);
  const index = typeof options.index === 'number' ? options.index : options.stashIndex ?? 0;
  if (!Number.isInteger(index) || index < 0 || !entries[index]) throw new GitError('NotFound', 'Stash entry does not exist', { index });
  return entries[index];
}

async function apply(repo, options) {
  const selected = await select(repo, options);
  const saved = await repo.readCommit(selected.oid, options);
  if (saved.parents.length < 2) throw new GitError('Corrupt', 'Stash commit must contain its base and index parents');
  if (repo.index.unmerged.length) throw new GitError('Conflict', 'Resolve the current index before applying a stash');
  await repo.loadRules(options);
  const base = await repo.readTree(saved.parents[0], options);
  const target = await repo.readTree(selected.oid, options);
  const current = await storedWorktree(repo, options);
  const initialIndex = repo.index.clone();
  const staged = indexTree(initialIndex);
  const ours = new Map([...current].filter(([path]) => staged.has(path) || base.has(path)));
  const merged = await mergeTrees(repo, base, ours, target, { ...options, oursLabel: 'Updated upstream', theirsLabel: 'Stashed changes' });
  const untracked = saved.parents[2] ? await repo.readTree(saved.parents[2], options) : new Map();
  for (const path of new Set([...merged.tree.keys(), ...untracked.keys()])) {
    if (current.has(path) && !ours.has(path)) throw new GitError('Conflict', 'Stash would overwrite an untracked file', { path });
    if ((options.dirtyPaths ?? []).includes(path) || (repo.dirtyBuffers && await repo.dirtyBuffers(path))) {
      throw new GitError('Conflict', 'Stash would overwrite an unsaved editor buffer', { path });
    }
  }
  const plan = await planCheckout(repo, merged.tree, { ...options, baseTree: ours, force: true, replaceAll: true });
  let next = initialIndex;
  if (options.restoreIndex || options.index === true) {
    const savedIndex = await repo.readTree(saved.parents[1], options);
    const indexMerge = await mergeTrees(repo, base, staged, savedIndex, options);
    if (!indexMerge.clean) throw new GitError('Conflict', 'Stash index cannot be restored without conflicts', { conflicts: indexMerge.conflicts });
    next = indexMerge.index;
  }
  if (!merged.clean) next = merged.index;
  plan.next = next;
  const snapshot = await repo.snapshot([...plan.changes.map(change => change.path), ...untracked.keys()]);
  try {
    await applyCheckout(repo, plan, options);
    for (const [path, entry] of untracked) {
      await repo.worktree.write(path, await repo.smudge(path, (await repo.odb.read(entry.oid, options)).data, options), { ...options, mode: entry.mode });
    }
  } catch (error) {
    await repo.restoreSnapshot(snapshot);
    throw error;
  }
  return { status: merged.clean ? 'applied' : 'conflicted', oid: selected.oid, index: selected.index, conflicts: merged.conflicts };
}

async function drop(repo, options) {
  const selected = await select(repo, options);
  if (selected.index === null) throw new GitError('Conflict', 'Dropping a stash requires its reflog index');
  const records = await repo.refs.reflog('refs/stash', options);
  records.splice(records.length - 1 - selected.index, 1);
  const tip = records.at(-1)?.newOid ?? null;
  const previous = await repo.refs.read('refs/stash');
  if (previous !== tip) await repo.refs.update('refs/stash', tip, { expected: previous, message: 'stash: drop' });
  if (!records.length) await repo.store.delete('logs/refs/stash');
  else {
    let oldOid = null;
    const text = records.map(record => {
      const value = serializeReflogEntry({ ...record, oldOid }, { algorithm: repo.algorithm });
      oldOid = record.newOid;
      return value;
    }).join('');
    await repo.store.set('logs/refs/stash', encoder.encode(text));
  }
  return { status: 'dropped', oid: selected.oid, index: selected.index };
}

/** Native-compatible stash commit triple with replay, reflog listing and conflict-safe pop. */
export async function stash(repo, action = 'push', options = {}) {
  const handlers = { push, apply, list, drop };
  if (action === 'pop') {
    const result = await apply(repo, options);
    if (result.status === 'applied') await drop(repo, options);
    return { ...result, dropped: result.status === 'applied' };
  }
  const handler = handlers[action];
  if (!handler) throw new GitError('Unsupported', 'Unsupported stash action', { action });
  return handler(repo, options);
}
