import { randomUUID } from 'node:crypto';

/** Bounded FIFO/priority scheduler. Tasks for the same project never execute concurrently. */
export class BuildScheduler {
  constructor({ concurrency = 1, maxQueued = 128, maxRecords = 32 } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64) throw new Error('Invalid concurrency');
    this.concurrency = concurrency;
    this.maxQueued = maxQueued;
    this.maxRecords = maxRecords;
    this.records = new Map();
    this.queue = [];
    this.running = new Map();
    this.closed = false;
    this.sequence = 0;
  }

  enqueue(request, execute, { key = request.project, coalesceKey = null, priority = 10 } = {}) {
    if (this.closed) throw new Error('MSBuild host is closing');
    if (this.queue.length >= this.maxQueued) throw Object.assign(new Error('Build queue limit exceeded'), { status: 429 });
    if (coalesceKey) {
      for (const entry of this.queue.filter(item => item.coalesceKey === coalesceKey)) this.cancel(entry.id, 'superseded');
    }
    this.prune();
    const id = randomUUID(), controller = new AbortController();
    let resolveResult;
    const promise = new Promise(resolve => { resolveResult = resolve; });
    const entry = { id, request, key, coalesceKey, priority, execute, controller, promise, resolveResult,
      sequence: this.sequence++, status: 'queued', result: null, error: null, cancelReason: null };
    this.records.set(id, entry);
    this.queue.push(entry);
    this.queue.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
    queueMicrotask(() => this.drain());
    return id;
  }

  prune() {
    while (this.records.size >= this.maxRecords) {
      const oldest = [...this.records.values()].find(entry => !['queued', 'running'].includes(entry.status));
      if (!oldest) break;
      this.records.delete(oldest.id);
    }
  }

  drain() {
    while (!this.closed && this.running.size < this.concurrency) {
      const index = this.queue.findIndex(entry => ![...this.running.values()].some(active => active.key === entry.key));
      if (index < 0) break;
      const [entry] = this.queue.splice(index, 1);
      entry.status = 'running';
      this.running.set(entry.id, entry);
      Promise.resolve().then(() => entry.execute(entry.id, entry.controller.signal)).then(
        result => { entry.result = result; entry.status = result?.status ?? 'succeeded'; },
        error => { entry.error = error; entry.status = entry.controller.signal.aborted ? 'cancelled' : 'failed'; }
      ).finally(() => {
        this.running.delete(entry.id);
        entry.resolveResult(entry);
        this.drain();
      });
    }
  }

  get(id) {
    const entry = this.records.get(id);
    if (!entry) throw Object.assign(new Error('Unknown or expired MSBuild job'), { status: 404 });
    return entry;
  }

  cancel(id, reason = 'user') {
    const entry = this.get(id);
    if (!['queued', 'running'].includes(entry.status)) return entry;
    entry.cancelReason ??= reason;
    entry.controller.abort(reason);
    if (entry.status === 'queued') {
      this.queue = this.queue.filter(item => item !== entry);
      entry.status = 'cancelled';
      entry.resolveResult(entry);
    }
    return entry;
  }

  async wait(id) { return this.get(id).promise; }

  async close() {
    this.closed = true;
    for (const entry of [...this.queue, ...this.running.values()]) this.cancel(entry.id, 'host-shutdown');
    await Promise.all([...this.running.values()].map(entry => entry.promise));
  }
}
