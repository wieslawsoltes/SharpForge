import { GitError, checkCancelled, checkLimit } from './errors.js';
import { decodeCommit, decodeTree, decodeTag } from './objects.js';

/** Return only object edges that belong to this repository; gitlinks refer to separate repositories. */
export function objectLinks(object, { algorithm = 'sha1', parents = true } = {}) {
  if (object.type === 'commit') {
    const commit = decodeCommit(object.data, { algorithm });
    return parents ? [commit.tree, ...commit.parents] : [commit.tree];
  }
  if (object.type === 'tree') return decodeTree(object.data, { algorithm }).filter(entry => entry.mode !== '160000' && entry.mode !== 0o160000)
    .map(entry => entry.oid);
  if (object.type === 'tag') return [decodeTag(object.data, { algorithm }).object];
  if (object.type === 'blob') return [];
  throw new GitError('Corrupt', 'Unknown object type in repository graph', { type: object.type });
}

/** Bounded linear graph traversal used for fetch haves, outgoing packs and maintenance reachability. */
export async function collectReachable({ odb, tips, exclude = new Set(), shallow = new Set(), algorithm = 'sha1',
  maxObjects = 1_000_000, signal, allowMissing = false }) {
  const seen = new Set();
  const queue = [...tips].filter(Boolean);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    checkCancelled(signal);
    const oid = queue[cursor];
    if (seen.has(oid) || exclude.has(oid)) continue;
    checkLimit(seen.size + 1, maxObjects, 'Reachable objects');
    if (allowMissing && !await odb.has(oid, { signal })) continue;
    const object = await odb.read(oid, { signal });
    seen.add(oid);
    for (const child of objectLinks(object, { algorithm, parents: !shallow.has(oid) })) {
      if (!seen.has(child) && !exclude.has(child)) queue.push(child);
    }
    checkLimit(queue.length, maxObjects * 16, 'Object graph edges');
  }
  return seen;
}

/** Commit-only ancestors include the tip; missing shallow parents are explicit boundaries. */
export async function collectAncestors({ odb, tips, shallow = new Set(), algorithm = 'sha1', maxCommits = 100_000, signal }) {
  const seen = new Set();
  const queue = [...tips].filter(Boolean);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    checkCancelled(signal);
    const oid = queue[cursor];
    if (seen.has(oid)) continue;
    checkLimit(seen.size + 1, maxCommits, 'Commit negotiation history');
    if (!await odb.has(oid, { signal })) continue;
    const object = await odb.read(oid, { signal });
    if (object.type === 'tag') { queue.push(decodeTag(object.data, { algorithm }).object); continue; }
    if (object.type !== 'commit') continue;
    seen.add(oid);
    if (!shallow.has(oid)) queue.push(...decodeCommit(object.data, { algorithm }).parents);
  }
  return seen;
}

/** Verify fetched closure with explicit shallow/promisor exceptions and no hidden lazy network reads. */
export async function verifyFetchedClosure({ odb, tips, shallow = new Set(), filter, algorithm = 'sha1', signal, maxObjects = 1_000_000 }) {
  const seen = new Set();
  const types = new Map();
  const queue = [...tips].map(oid => ({ oid, type: null }));
  const promised = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    checkCancelled(signal);
    const { oid, type } = queue[cursor];
    if (type && types.has(oid) && types.get(oid) !== type) {
      throw new GitError('Corrupt', 'Fetched graph has conflicting object type requirements', { oid, type, actual: types.get(oid) });
    }
    if (seen.has(oid)) continue;
    checkLimit(seen.size + 1, maxObjects, 'Fetch connectivity objects');
    seen.add(oid);
    if (!await odb.has(oid, { signal })) {
      if ((type === 'blob' && filter?.startsWith('blob:')) || (type === 'tree' && filter === 'tree:0')) {
        types.set(oid, type);
        promised.push({ oid, type });
        continue;
      }
      throw new GitError('Corrupt', 'Fetched object graph is incomplete', { oid, type });
    }
    const object = await (odb.readLocal?.(oid, { signal }) ?? odb.read(oid, { signal }));
    types.set(oid, object.type);
    if (type && object.type !== type) {
      throw new GitError('Corrupt', 'Fetched graph edge has the wrong object type', { oid, expected: type, actual: object.type });
    }
    if (object.type === 'commit') {
      const commit = decodeCommit(object.data, { algorithm });
      queue.push({ oid: commit.tree, type: 'tree' });
      if (!shallow.has(oid)) queue.push(...commit.parents.map(parent => ({ oid: parent, type: 'commit' })));
    } else if (object.type === 'tree') {
      for (const entry of decodeTree(object.data, { algorithm })) {
        const mode = typeof entry.mode === 'string' ? Number.parseInt(entry.mode, 8) : entry.mode;
        if (mode !== 0o160000) queue.push({ oid: entry.oid, type: mode === 0o40000 ? 'tree' : 'blob' });
      }
    } else if (object.type === 'tag') {
      const tag = decodeTag(object.data, { algorithm });
      queue.push({ oid: tag.object, type: tag.type });
    }
  }
  return { visited: seen.size, promised };
}
