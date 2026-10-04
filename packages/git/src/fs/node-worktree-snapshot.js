import { nodeWorktreeIdentity, nodeWorktreeMode, sameNodeStat } from './node-worktree-stat.js';

/** Instance-owned scan proofs. Caller-created or serialized snapshots cannot authorize the fast reader. */
export class NodeWorktreeSnapshots {
  names = new Set();
  #entries = new Map();
  #tokens = new WeakMap();
  #scans = new WeakMap();

  clear() {
    this.names.clear();
    this.#entries.clear();
    this.#tokens = new WeakMap();
    this.#scans = new WeakMap();
  }

  record(path, absolute, stat, options) {
    const previous = this.#entries.get(path);
    const token = previous && this.#tokens.get(previous);
    if (token && previous.stat.cacheable && options.observedAt >= token.observedAt && sameNodeStat(token.stat, stat)) {
      return previous;
    }
    const metadata = nodeWorktreeIdentity(stat, options.observedAt);
    Object.freeze(metadata.identity);
    const entry = Object.freeze({ mode: nodeWorktreeMode(stat), stat: Object.freeze(metadata) });
    if (this.#entries.size >= options.maxEntries && !this.#entries.has(path)) this.#entries.clear();
    this.#entries.set(path, entry);
    this.#tokens.set(entry, { path, absolute, stat, observedAt: options.observedAt });
    return entry;
  }

  finish(snapshot, parents) {
    for (const path of this.#entries.keys()) if (!snapshot.has(path)) this.#entries.delete(path);
    this.#scans.set(snapshot, parents);
  }

  readContext(snapshot, paths) {
    const knownParents = this.#scans.get(snapshot);
    if (!knownParents) return null;
    const tokens = [];
    const parents = new Set();
    for (const path of paths) {
      const token = this.#tokens.get(snapshot.get(path));
      if (!token || token.path !== path || token.stat.size > 65536n
        || ![0o100644, 0o100755].includes(nodeWorktreeMode(token.stat))) return null;
      tokens.push(token);
      let parent = path;
      do {
        parent = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : '';
        const proof = knownParents.get(parent);
        if (!proof) return null;
        parents.add(proof);
      } while (parent);
    }
    return { tokens, parents };
  }
}
