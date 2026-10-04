import {PropertyFault} from '../dependency-property.js';

/** FIFO reentrancy boundary; repeated pending changes coalesce without reordering. */
export class ChangeNotificationQueue {
  constructor({maxChanges = 10000, autoDrain = true} = {}) {
    if (!Number.isSafeInteger(maxChanges) || maxChanges < 1) throw new RangeError('Invalid notification budget');
    this.maxChanges = maxChanges;
    this.autoDrain = autoDrain;
    this.pending = new Map();
    this.items = [];
    this.head = 0;
    this.draining = false;
    this.depth = 0;
    this.disposed = false;
  }

  /** Enqueue using an identity key owned by the producer, never a global ID. */
  enqueue(key, callback, change) {
    if (this.disposed) return;
    const existing = this.pending.get(key);
    if (existing) existing.change = {...change, oldValue: existing.change.oldValue, oldSource: existing.change.oldSource};
    else {
      if (this.pending.size >= this.maxChanges) this.fail();
      if (this.items.length - this.head >= this.maxChanges) {
        this.items = this.items.slice(this.head).filter(entry => !entry.cancelled);
        this.head = 0;
      }
      const entry = {key, callback, change};
      this.pending.set(key, entry);
      this.items.push(entry);
    }
    if (this.autoDrain && !this.depth) this.drain();
  }

  cancel(key) {
    const entry = this.pending.get(key);
    if (!entry) return false;
    entry.cancelled = true;
    this.pending.delete(key);
    return true;
  }

  /** Defer delivery until the outer batch finishes; exceptions remain visible. */
  batch(action) {
    this.depth++;
    try {
      return action();
    } finally {
      this.depth--;
      if (!this.depth && this.autoDrain) this.drain();
    }
  }

  /** Drain synchronously with a deterministic total-change budget. */
  drain() {
    if (this.draining || this.depth || this.disposed) return 0;
    this.draining = true;
    let count = 0;
    try {
      while (this.head < this.items.length) {
        const entry = this.items[this.head++];
        if (entry.cancelled) continue;
        if (++count > this.maxChanges) this.fail();
        this.pending.delete(entry.key);
        entry.callback(entry.change);
      }
      return count;
    } finally {
      this.items.length = 0;
      this.head = 0;
      this.pending.clear();
      this.draining = false;
    }
  }

  fail() {
    throw new PropertyFault('InvalidOperationException', 'Property notification cycle exceeded its change budget');
  }

  snapshot() {
    return {version: 1, disposed: this.disposed,
      items: this.items.slice(this.head).filter(entry => !entry.cancelled).map(entry => ({...entry}))};
  }

  /** Restore pending deliveries without draining or invoking producer callbacks. */
  restore(snapshot) {
    if (snapshot?.version !== 1 || typeof snapshot.disposed !== 'boolean' || !Array.isArray(snapshot.items)
      || snapshot.items.length > this.maxChanges) throw new TypeError('Invalid notification queue snapshot');
    const items = [], pending = new Map();
    for (const value of snapshot.items) {
      if (!value || typeof value.callback !== 'function' || pending.has(value.key)) throw new TypeError('Invalid queued notification');
      const entry = {...value, cancelled: false};
      pending.set(entry.key, entry);
      items.push(entry);
    }
    this.pending = pending;
    this.items = items;
    this.head = 0;
    this.depth = 0;
    this.draining = false;
    this.disposed = snapshot.disposed;
  }

  /** Drop queued work on owner teardown. */
  dispose() {
    this.disposed = true;
    this.items.length = 0;
    this.head = 0;
    this.pending.clear();
  }
}
