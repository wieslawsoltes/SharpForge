/** Binary heap priority queue used by graph walks without O(n²) array re-sorting. */
export class GraphPriorityQueue {
  constructor(compare) {
    this.compare = compare;
    this.values = [];
  }

  get size() { return this.values.length; }

  push(value) {
    const values = this.values;
    let index = values.length;
    values.push(value);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (this.compare(values[parent], value) <= 0) break;
      values[index] = values[parent];
      index = parent;
    }
    values[index] = value;
  }

  pop() {
    const values = this.values;
    if (!values.length) return null;
    const result = values[0];
    const last = values.pop();
    if (!values.length) return result;
    let index = 0;
    while (index * 2 + 1 < values.length) {
      let child = index * 2 + 1;
      if (child + 1 < values.length && this.compare(values[child + 1], values[child]) < 0) child++;
      if (this.compare(last, values[child]) <= 0) break;
      values[index] = values[child];
      index = child;
    }
    values[index] = last;
    return result;
  }
}

export function commitTimestamp(commit) {
  if (typeof commit.committer === 'object') return Number(commit.committer.timestamp) || 0;
  return Number(/ (\d+) [+-]\d{4}$/u.exec(commit.committer ?? '')?.[1]) || 0;
}

export function topologicalOrder(commits, { order = 'topo' } = {}) {
  const children = new Map([...commits.keys()].map(oid => [oid, 0]));
  for (const commit of commits.values()) {
    for (const parent of commit.parents) if (children.has(parent)) children.set(parent, children.get(parent) + 1);
  }
  const compare = (left, right) => commitTimestamp(right) - commitTimestamp(left) || left.oid.localeCompare(right.oid);
  if (order === 'date') return [...commits.values()].sort(compare);
  const ready = new GraphPriorityQueue(compare);
  for (const commit of commits.values()) if (children.get(commit.oid) === 0) ready.push(commit);
  const result = [];
  while (ready.size) {
    const commit = ready.pop();
    result.push(commit);
    for (const parent of commit.parents) {
      if (!children.has(parent)) continue;
      children.set(parent, children.get(parent) - 1);
      if (children.get(parent) === 0) ready.push(commits.get(parent));
    }
  }
  return result;
}
