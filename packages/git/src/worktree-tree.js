import { GitError, checkCancelled, checkLimit } from './errors.js';
import { decodeTree, encodeTree } from './objects.js';
import { validateCheckoutPath } from './path-safety.js';
import { peelRevision } from './revparse.js';

/** Flatten a commit/tree into a bounded path map without recursing on the JS stack. */
export async function readTree(repo, revision = 'HEAD', { signal, maxEntries = 1000000 } = {}) {
  let oid;
  try { oid = await repo.revParse(revision, { signal }); }
  catch (error) {
    if (error.code === 'NotFound' && revision === 'HEAD' && !(await repo.refs.read('HEAD'))) return new Map();
    throw error;
  }
  if (typeof oid !== 'string') throw new GitError('Corrupt', 'Tree reader requires a scalar revision');
  return readObjectTree(repo, oid, { signal, maxEntries });
}

/** Status compares the actual HEAD, without probing similarly named tags or remote branches. */
export async function readHeadTree(repo, options = {}) {
  checkCancelled(options.signal);
  const oid = await repo.refs.read('HEAD', options);
  return oid ? readObjectTree(repo, oid, options, true) : new Map();
}

async function readObjectTree(repo, oid, { signal, maxEntries = 1000000 } = {}, view = false) {
  oid = await peelRevision(repo, oid, 'tree', { signal });
  const existing = repo.treeCache?.get(repo.odb, oid, maxEntries, view);
  if (existing) return existing;
  const result = new Map();
  const queue = [{ oid, prefix: '', ancestors: new Set(), depth: 0 }];
  checkLimit(queue.length, maxEntries, 'Tree entries');
  const cached = new Map();
  for (let position = 0; position < queue.length; position++) {
    checkCancelled(signal);
    const item = queue[position];
    checkLimit(item.depth, 512, 'Tree depth');
    if (item.ancestors.has(item.oid)) throw new GitError('Corrupt', 'Tree contains a cycle');
    let entries = cached.get(item.oid);
    if (!entries) {
      const object = await repo.odb.read(item.oid, { signal });
      if (object.type !== 'tree') throw new GitError('Corrupt', 'Tree points to a non-tree object', { oid: item.oid });
      entries = decodeTree(object.data, { algorithm: repo.algorithm });
      cached.set(item.oid, entries);
    }
    for (const entry of entries) {
      if (entry.name === null) throw new GitError('Unsupported', 'Worktree paths must be valid UTF-8');
      const path = item.prefix + entry.name;
      if (entry.mode === 0o40000) queue.push({ oid: entry.oid, prefix: `${path}/`, depth: item.depth + 1,
        ancestors: new Set([...item.ancestors, item.oid]) });
      else {
        if (result.has(path)) throw new GitError('Corrupt', 'Tree contains a duplicate path', { path });
        result.set(path, { path, mode: entry.mode, oid: entry.oid });
      }
      checkLimit(result.size + queue.length, maxEntries, 'Tree entries');
    }
  }
  const cachedView = repo.treeCache?.set(repo.odb, oid, result, result.size + queue.length, { takeOwnership: view });
  return view && cachedView ? cachedView : result;
}

/** Write bottom-up Git tree objects from stage-zero index entries in O(P log P) order. */
export async function writeTree(repo, { index = repo.index, signal } = {}) {
  if (index.unmerged.length) throw new GitError('Conflict', 'Cannot write a tree with unresolved index stages');
  const directories = new Map([['', []]]);
  const paths = new Set();
  for (const entry of index.entries) {
    checkCancelled(signal);
    if (entry.intentToAdd) continue;
    validateCheckoutPath(entry.path);
    const components = entry.path.split('/');
    const name = components.pop();
    let prefix = '';
    for (const component of components) {
      const child = prefix ? `${prefix}/${component}` : component;
      if (paths.has(child)) throw new GitError('Conflict', 'Index contains a directory/file collision', { path: child });
      if (!directories.has(child)) {
        directories.set(child, []);
        directories.get(prefix).push({ name: component, mode: 0o40000, child });
      }
      prefix = child;
    }
    if (directories.has(entry.path)) throw new GitError('Conflict', 'Index contains a file/directory collision', { path: entry.path });
    paths.add(entry.path);
    directories.get(prefix).push({ name, mode: entry.mode, oid: entry.oid });
  }
  const trees = new Map();
  const ordered = [...directories.keys()].sort((left, right) => right.split('/').length - left.split('/').length || right.length - left.length);
  for (const path of ordered) {
    checkCancelled(signal);
    const entries = directories.get(path).map(entry => entry.child ? { name: entry.name, mode: entry.mode, oid: trees.get(entry.child) } : entry);
    trees.set(path, await repo.odb.write('tree', encodeTree(entries, { algorithm: repo.algorithm }), { signal }));
  }
  return trees.get('');
}

export function indexTree(index, { view = false } = {}) {
  if (view && index.treeView) return index.treeView;
  return new Map(index.entries.filter(entry => entry.stage === 0 && !entry.intentToAdd).map(entry => [entry.path, entry]));
}
