import { checkCancelled, checkLimit } from './errors.js';

/** Traverse one fixed shallow-boundary snapshot; canonical cached commit records remain untouched. */
export async function reachableCommits(graph, tips, context, stop = new Set()) {
  const commits = new Map();
  const queue = [...new Set((Array.isArray(tips) ? tips : [tips]).filter(Boolean))];
  const queued = new Set(queue);
  for (let index = 0; index < queue.length; index++) {
    checkCancelled(context.signal);
    const oid = queue[index];
    if (stop.has(oid)) continue;
    checkLimit(commits.size + 1, context.maxCommits ?? graph.maxCommits, 'Commit graph nodes');
    const commit = graph.project(await graph.read(oid, context), context);
    commits.set(oid, commit);
    for (const parent of commit.parents) {
      if (queued.has(parent)) continue;
      queued.add(parent);
      queue.push(parent);
    }
  }
  return commits;
}
