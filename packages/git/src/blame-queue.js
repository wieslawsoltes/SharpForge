/** A per-operation commit-date heap combines suspects without rescanning the entire pending queue. */
export class BlameQueue {
  constructor(repository, options) {
    this.repository = repository;
    this.options = options;
    this.pending = new Map();
    this.heap = [];
    this.sequence = 0;
  }

  get size() { return this.heap.length; }

  async add(job) {
    if (!job.positions.length) return;
    const key = `${job.oid}\0${job.path}`;
    const existing = this.pending.get(key);
    if (existing) {
      for (const position of job.positions) existing.positions.push(position);
      return;
    }
    const commit = await this.repository.readCommit(job.oid, this.options);
    const entry = { ...job, commit, key, sequence: this.sequence++, timestamp: commit.committer?.timestamp ?? 0 };
    this.pending.set(key, entry);
    let index = this.heap.length;
    this.heap.push(entry);
    while (index) {
      const parent = (index - 1) >>> 1;
      if (!earlier(entry, this.heap[parent])) break;
      this.heap[index] = this.heap[parent];
      index = parent;
    }
    this.heap[index] = entry;
  }

  take() {
    const entry = this.heap[0];
    const last = this.heap.pop();
    this.pending.delete(entry.key);
    if (!this.heap.length) return entry;
    let index = 0;
    while (index * 2 + 1 < this.heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < this.heap.length && earlier(this.heap[child + 1], this.heap[child])) child++;
      if (!earlier(this.heap[child], last)) break;
      this.heap[index] = this.heap[child];
      index = child;
    }
    this.heap[index] = last;
    return entry;
  }
}

function earlier(left, right) {
  return left.timestamp > right.timestamp || left.timestamp === right.timestamp && left.sequence < right.sequence;
}
