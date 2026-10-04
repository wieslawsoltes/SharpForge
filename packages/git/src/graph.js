import { GitError, checkCancelled, checkLimit } from './errors.js';
import { decodeCommit } from './objects.js';
import { topologicalOrder } from './graph-order.js';
import { ensureGenerations } from './graph-generation.js';
import { generationMergeBases } from './graph-merge-base.js';
import { reachableCommits } from './graph-traversal.js';
import { parseShallow } from './shallow.js';
import { getObjectFormat, validateObjectId } from './object-format.js';

/** Cached commit graph with bounded O(V+E) reachability and topological walks. */
export class CommitGraph {
  constructor({ odb, store = odb?.store, algorithm = 'sha1', maxCommits = 1000000, shallow = [], onShallowChange } = {}) {
    this.odb = odb;
    this.algorithm = algorithm;
    this.maxCommits = maxCommits;
    this.cache = new Map();
    this.generations = new Map();
    this.store = store;
    this.shallow = new Set();
    this.onShallowChange = onShallowChange;
    this.setShallow(shallow);
  }

  /** Change graph boundaries without altering immutable commits; active traversals retain their own cache snapshot. */
  setShallow(boundaries) {
    const shallow = new Set();
    let count = 0;
    for (const oid of boundaries) {
      checkLimit(++count, this.maxCommits, 'Shallow boundary entries');
      shallow.add(validateObjectId(oid, this.algorithm, { allowZero: false }));
    }
    if (shallow.size === this.shallow.size && [...shallow].every(oid => this.shallow.has(oid))) return false;
    this.shallow = shallow;
    this.generations = new Map();
    this.onShallowChange?.(shallow);
    return true;
  }

  /** Observe boundaries written by clone/fetch/deepen or another local repository session. */
  async refreshShallow(options = {}) {
    checkCancelled(options.signal);
    if (this.store) {
      const bytes = await this.store.get('shallow', options);
      checkCancelled(options.signal);
      checkLimit(bytes?.length ?? 0, this.maxCommits * (getObjectFormat(this.algorithm).oidLength + 1), 'Shallow boundary bytes');
      this.setShallow(parseShallow(bytes, { algorithm: this.algorithm }));
    }
    return this.shallow;
  }

  async context(options = {}) {
    await this.refreshShallow(options);
    return { ...options, shallow: this.shallow, generations: this.generations };
  }

  parents(commit, { shallow = this.shallow } = {}) { return shallow.has(commit.oid) ? [] : commit.parents; }

  project(commit, context = {}) {
    return (context.shallow ?? this.shallow).has(commit.oid) ? { ...commit, parents: [], shallow: true } : commit;
  }

  async read(oid, { signal } = {}) {
    checkCancelled(signal);
    let commit = this.cache.get(oid);
    if (commit) return commit;
    const object = await this.odb.read(oid, { signal });
    if (object.type !== 'commit') throw new GitError('Corrupt', 'Commit graph references a non-commit', { oid, type: object.type });
    commit = { oid, ...decodeCommit(object.data, { algorithm: this.algorithm }) };
    if (this.cache.size >= this.maxCommits) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(oid, commit);
    return commit;
  }

  async reachable(tips, options = {}) {
    return reachableCommits(this, tips, await this.context(options), options.stop);
  }

  async walk(tips, options = {}) {
    const context = await this.context(options);
    const { exclude = [], order = 'topo', firstParent = false, generations } = context;
    const omitted = await reachableCommits(this, exclude, context);
    let commits = await reachableCommits(this, tips, context, new Set(omitted.keys()));
    if (firstParent) {
      const selected = new Map();
      for (const tip of Array.isArray(tips) ? tips : [tips]) {
        let current = commits.get(tip);
        while (current && !selected.has(current.oid)) {
          selected.set(current.oid, current);
          current = commits.get(current.parents[0]);
        }
      }
      commits = selected;
    }
    const result = topologicalOrder(commits, { order });
    if (result.length !== commits.size) throw new GitError('Corrupt', 'Commit graph contains a parent cycle');
    for (let index = result.length - 1; index >= 0; index--) {
      const commit = result[index];
      if (commit.parents.every(parent => generations.has(parent))) {
        let maximum = 0;
        for (const parent of commit.parents) maximum = Math.max(maximum, generations.get(parent));
        checkLimit(generations.size + (generations.has(commit.oid) ? 0 : 1), this.maxCommits, 'Cached generation entries');
        generations.set(commit.oid, 1 + maximum);
      }
    }
    return result;
  }

  async isAncestor(ancestor, descendant, options = {}) {
    const context = await this.context(options);
    const { generations } = context;
    if (ancestor === descendant) return true;
    const minimumGeneration = generations.get(ancestor) ?? 0;
    const visited = new Set();
    const queue = [descendant];
    for (let index = 0; index < queue.length; index++) {
      checkCancelled(context.signal);
      const oid = queue[index];
      if (visited.has(oid)) continue;
      visited.add(oid);
      checkLimit(visited.size, this.maxCommits, 'Ancestry nodes');
      if ((generations.get(oid) ?? Infinity) < minimumGeneration) continue;
      const commit = await this.read(oid, context);
      for (const parent of this.parents(commit, context)) {
        if (parent === ancestor) return true;
        queue.push(parent);
      }
    }
    return false;
  }

  /** Return every best common ancestor, including criss-cross merge bases. */
  async mergeBases(left, right, options = {}) { return generationMergeBases(this, left, right, await this.context(options)); }

  async ensureGenerations(tips, options = {}) { return ensureGenerations(this, tips, await this.context(options)); }
}

export async function mergeBase(graph, left, right, options) {
  return graph.mergeBases(left, right, options);
}

export async function isAncestor(graph, ancestor, descendant, options) {
  return graph.isAncestor(ancestor, descendant, options);
}
