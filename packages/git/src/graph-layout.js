import { GitError, checkCancelled, checkLimit } from './errors.js';

/** Stable lanes in O(commits * maxLanes), with an explicit maximum width. */
export function layoutCommitGraph(commits, { maxLanes = 128, signal, state } = {}) {
  if (!Array.isArray(commits)) throw new GitError('Corrupt', 'Graph commits must be an array');
  checkLimit(commits.length, 1000000, 'Graph rows');
  validateCommits(commits, signal);
  checkLimit(maxLanes, 1024, 'Graph lane count');
  if (maxLanes < 1) throw new GitError('Limit', 'A graph requires at least one lane');
  const lanes = [...state?.lanes ?? []];
  checkLimit(lanes.length, maxLanes, 'Continued graph lanes');
  const index = new Map();
  for (const [lane, oid] of lanes.entries()) {
    if (oid === null) continue;
    if (typeof oid !== 'string' || !oid || oid.length > 128 || index.has(oid)) {
      throw new GitError('Corrupt', 'Invalid continued graph frontier');
    }
    index.set(oid, lane);
  }
  const rows = [];
  let width = Math.max(1, checkLimit(state?.width ?? 1, maxLanes, 'Continued graph width'), lanes.length);
  for (const commit of commits) {
    checkCancelled(signal);
    let lane = index.get(commit.oid);
    if (lane === undefined) lane = reserveLane(commit.oid, lanes, index, maxLanes);
    const through = [];
    for (let position = 0; position < lanes.length; position++) {
      if (lanes[position] && position !== lane) through.push(position);
    }
    index.delete(commit.oid);
    lanes[lane] = null;
    const edges = [];
    for (const [parentIndex, parent] of (commit.parents ?? []).entries()) {
      let destination = index.get(parent);
      if (destination === undefined) {
        destination = parentIndex === 0 && !lanes[lane] ? lane : reserveLane(parent, lanes, index, maxLanes);
        lanes[destination] = parent;
        index.set(parent, destination);
      }
      edges.push(Object.freeze({ from: lane, to: destination, parent, parentIndex }));
      width = Math.max(width, destination + 1);
    }
    width = Math.max(width, lane + 1);
    rows.push(Object.freeze({ oid: commit.oid, lane, color: lane, through: Object.freeze(through), edges: Object.freeze(edges) }));
    while (lanes.length && !lanes[lanes.length - 1]) lanes.pop();
  }
  return Object.freeze({ rows: Object.freeze(rows), width,
    state: Object.freeze({ lanes: Object.freeze([...lanes]), width }) });
}

function validateCommits(commits, signal) {
  const seen = new Set();
  const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
  for (const commit of commits) {
    checkCancelled(signal);
    if (!commit || !validId(commit.oid) || seen.has(commit.oid) || !Array.isArray(commit.parents ?? [])) {
      throw new GitError('Corrupt', 'Invalid or duplicate commit in graph input');
    }
    seen.add(commit.oid);
    const parents = new Set();
    for (const parent of commit.parents ?? []) {
      if (!validId(parent) || parent === commit.oid || parents.has(parent)) {
        throw new GitError('Corrupt', 'Invalid or duplicate graph parent');
      }
      parents.add(parent);
    }
  }
}

function reserveLane(oid, lanes, index, maximum) {
  let lane = lanes.indexOf(null);
  if (lane < 0) lane = lanes.length;
  if (lane >= maximum) throw new GitError('Limit', 'Commit graph exceeds the configured lane width', { maximum });
  lanes[lane] = oid;
  index.set(oid, lane);
  return lane;
}
