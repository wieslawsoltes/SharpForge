/** Coalesce editor save bursts without suppressing an unrelated external write to the same path. */
export class FileWatchCoalescer {
  constructor(listener, {delayMs = 75, maxPending = 10000, ownWriteTtlMs = 5000, scheduler = globalThis,
    now = () => performance.now()} = {}) {
    if (typeof listener !== 'function') throw new TypeError('A watcher listener is required');
    this.listener = listener;
    this.delayMs = delayMs;
    this.maxPending = maxPending;
    this.ownWriteTtlMs = ownWriteTtlMs;
    this.scheduler = scheduler;
    this.now = now;
    this.pending = new Map();
    this.ownWrites = new Map();
    this.disposed = false;
  }

  markOwnWrite(path, hash) {
    if (typeof hash !== 'string' || !hash) throw new TypeError('Own-write suppression requires an exact byte hash');
    this.ownWrites.set(path, {hash, expires: this.now() + this.ownWriteTtlMs});
    if (this.pending.get(path)?.hash === hash) this.pending.delete(path);
    while (this.ownWrites.size > this.maxPending) this.ownWrites.delete(this.ownWrites.keys().next().value);
  }

  push(event) {
    if (this.disposed) return;
    const own = this.ownWrites.get(event.path);
    if (own && own.expires < this.now()) this.ownWrites.delete(event.path);
    if (own && own.expires >= this.now() && event.hash === own.hash) {
      this.ownWrites.delete(event.path);
      this.pending.delete(event.path);
      return;
    }
    let next = {...event};
    if (event.type === 'renamed' && event.oldPath && this.pending.get(event.oldPath)?.type === 'created') {
      this.pending.delete(event.oldPath);
      next = {...event, type: 'changed'};
      delete next.oldPath;
    }
    const previous = this.pending.get(next.path);
    if (previous?.type === 'deleted' && ['created', 'renamed'].includes(next.type)) next = {...next, type: 'changed'};
    if (previous?.type === 'created' && next.type === 'changed') next = {...next, type: 'created'};
    if (previous?.type === 'created' && next.type === 'deleted') this.pending.delete(next.path);
    else this.pending.set(next.path, next);
    if (this.pending.size >= this.maxPending) this.flush();
    this.scheduler.clearTimeout(this.timer);
    this.timer = this.scheduler.setTimeout(() => this.flush(), this.delayMs);
  }

  flush() {
    this.scheduler.clearTimeout(this.timer);
    const events = [...this.pending.values()];
    this.pending.clear();
    for (const event of events) if (!this.disposed) this.listener(event);
    return events;
  }

  dispose() {
    this.disposed = true;
    this.scheduler.clearTimeout(this.timer);
    this.pending.clear();
    this.ownWrites.clear();
  }
}
