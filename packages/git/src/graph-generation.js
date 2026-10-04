import { GitError, checkCancelled, checkLimit } from './errors.js';

/** Compute missing topological generation numbers iteratively, retaining immutable commit results. */
export async function ensureGenerations(graph, tips, options = {}) {
  const { signal, maxCommits = graph.maxCommits, generations = graph.generations } = options;
  checkLimit(maxCommits, graph.maxCommits, 'Generation walk limit');
  const active = new Set();
  let visited = 0;
  for (const oid of new Set((Array.isArray(tips) ? tips : [tips]).filter(Boolean))) {
    const pending = [{ oid, commit: null, parent: 0, maximum: 0 }];
    while (pending.length) {
      checkCancelled(signal);
      const current = pending.at(-1);
      if (generations.has(current.oid)) { active.delete(current.oid); pending.pop(); continue; }
      if (!current.commit) {
        checkLimit(++visited, maxCommits, 'Generation walk commits');
        current.commit = graph.project(await graph.read(current.oid, { signal }), options);
        active.add(current.oid);
      }
      const parent = current.commit.parents[current.parent];
      if (parent) {
        const generation = generations.get(parent);
        if (generation !== undefined) {
          current.maximum = Math.max(current.maximum, generation);
          current.parent++;
        } else {
          if (active.has(parent)) throw new GitError('Corrupt', 'Commit graph contains a parent cycle');
          pending.push({ oid: parent, commit: null, parent: 0, maximum: 0 });
        }
      } else {
        checkLimit(generations.size + 1, graph.maxCommits, 'Cached generation entries');
        generations.set(current.oid, current.maximum + 1);
        active.delete(current.oid);
        pending.pop();
      }
    }
  }
  return generations;
}
