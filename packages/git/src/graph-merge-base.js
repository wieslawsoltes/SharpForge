import { checkCancelled, checkLimit } from './errors.js';
import { GraphPriorityQueue } from './graph-order.js';
import { ensureGenerations } from './graph-generation.js';

const fromLeft = 1;
const fromRight = 2;
const stale = 4;

/** Paint both tips in generation order, stopping once every remaining ancestor is redundant. */
export async function generationMergeBases(graph, left, right, options = {}) {
  checkCancelled(options.signal);
  if (left === right) { await graph.read(left, options); return [left]; }
  const generations = await ensureGenerations(graph, [left, right], options);
  const queue = new GraphPriorityQueue((before, after) => generations.get(after) - generations.get(before)
    || (before < after ? -1 : before > after ? 1 : 0));
  const states = new Map();
  const results = new Set();
  let active = 0;
  const add = (oid, flags) => {
    let state = states.get(oid);
    if (!state) { state = { flags: 0, queued: false }; states.set(oid, state); }
    if ((state.flags | flags) === state.flags) return;
    if (state.queued && !(state.flags & stale) && (flags & stale)) active--;
    state.flags |= flags;
    if (flags & stale) results.delete(oid);
    if (!state.queued) {
      state.queued = true;
      queue.push(oid);
      if (!(state.flags & stale)) active++;
    }
  };
  add(left, fromLeft);
  add(right, fromRight);
  const visited = new Set();
  while (queue.size && active) {
    checkCancelled(options.signal);
    const oid = queue.pop();
    const state = states.get(oid);
    state.queued = false;
    if (!(state.flags & stale)) active--;
    visited.add(oid);
    checkLimit(visited.size, options.maxCommits ?? graph.maxCommits, 'Merge-base painted commits');
    let flags = state.flags;
    if ((flags & (fromLeft | fromRight | stale)) === (fromLeft | fromRight)) {
      results.add(oid);
      flags |= stale;
    }
    const commit = await graph.read(oid, options);
    for (const parent of graph.parents(commit, options)) add(parent, flags);
  }
  options.onProgress?.({ phase: 'merge-base', visited: visited.size, bases: results.size });
  return [...results].sort();
}
