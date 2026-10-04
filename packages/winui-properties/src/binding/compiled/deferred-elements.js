import {PropertyFault} from '../../property/values.js';

/** Named x:Load factories remain unrealized until load=true or an explicit FindName request. */
export class DeferredElementScope {
  constructor({attach = () => {}, detach = () => {}, dispose = value => value.dispose?.(), identity = value => value,
    maxNames = 10000, maxDepth = 64} = {}) {
    this.attach = attach;
    this.detach = detach;
    this.disposeValue = dispose;
    this.identity = identity;
    this.maxNames = maxNames;
    this.maxDepth = maxDepth;
    if (![maxNames, maxDepth].every(value => Number.isSafeInteger(value) && value > 0) || maxNames > 1000000 || maxDepth > 128) {
      throw new RangeError('Invalid deferred element budgets');
    }
    this.entries = new Map();
    this.created = new WeakSet();
    this.depth = 0;
    this.disposed = false;
  }

  register(name, factory) {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'Deferred namescope is disposed');
    if (typeof name !== 'string' || !name || name.length > 1024 || typeof factory !== 'function') {
      throw new TypeError('A bounded name and factory are required');
    }
    if (this.entries.has(name) || this.entries.size >= this.maxNames) throw new PropertyFault('ArgumentException', 'Deferred name duplicate or limit');
    const entry = {factory, value: null, loading: false};
    this.entries.set(name, entry);
    return () => {
      if (this.disposed || this.entries.get(name) !== entry) return;
      this.setLoad(name, false);
      this.entries.delete(name);
    };
  }

  FindName(name) {
    if (this.disposed) return null;
    const entry = this.entries.get(name);
    if (!entry) return null;
    if (entry.value) return entry.value;
    if (entry.loading || this.depth >= this.maxDepth) throw new PropertyFault('InvalidOperationException', 'Deferred realization cycle or depth limit');
    entry.loading = true;
    this.depth++;
    let value = null;
    let fresh = false;
    try {
      value = entry.factory();
      const identity = value && typeof value === 'object' ? this.identity(value) : null;
      if (!value || typeof value !== 'object' || value.then || !identity || typeof identity !== 'object' || this.created.has(identity)) {
        throw new PropertyFault('InvalidOperationException', 'A deferred factory must produce a fresh element synchronously');
      }
      fresh = true;
      this.created.add(identity);
      this.attach(name, value);
      entry.value = value;
      return value;
    } catch (error) {
      if (fresh) this.disposeValue(value);
      throw error;
    } finally {
      entry.loading = false;
      this.depth--;
    }
  }

  setLoad(name, enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('x:Load requires a Boolean');
    const entry = this.entries.get(name);
    if (!entry) throw new PropertyFault('ArgumentException', 'Deferred element name is not registered');
    if (enabled) return this.FindName(name);
    if (!entry.value) return null;
    const value = entry.value;
    this.detach(name, value);
    entry.value = null;
    this.disposeValue(value);
    return null;
  }

  peek(name) { return this.entries.get(name)?.value ?? null; }
  findName(name) { return this.FindName(name); }

  *retainedValues() {
    for (const entry of this.entries.values()) {
      yield entry.value;
      if (entry.factory.retainedValues) yield* entry.factory.retainedValues();
    }
  }

  snapshot() {
    if (this.depth) throw new PropertyFault('InvalidOperationException', 'Cannot snapshot a realizing deferred factory');
    return {version: 1, disposed: this.disposed, entries: [...this.entries].map(([name, entry]) => [name, {...entry}])};
  }

  /** The host restores its scene first. Factories, attach/detach and user cleanup are not replayed. */
  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.entries) || snapshot.entries.length > this.maxNames
      || snapshot.entries.some(item => !Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string'
        || !item[0] || item[0].length > 1024 || typeof item[1]?.factory !== 'function' || item[1].loading)
      || new Set(snapshot.entries.map(entry => entry[0])).size !== snapshot.entries.length) {
      throw new TypeError('Invalid deferred namescope snapshot');
    }
    this.entries = new Map(snapshot.entries.map(([name, entry]) => [name, {...entry}]));
    this.disposed = snapshot.disposed;
    this.depth = 0;
    for (const entry of this.entries.values()) if (entry.value) this.created.add(this.identity(entry.value));
  }

  dispose() {
    if (this.disposed) return;
    const errors = [];
    for (const name of this.entries.keys()) {
      try { this.setLoad(name, false); } catch (error) { errors.push(error); }
    }
    this.entries.clear();
    this.disposed = true;
    if (errors.length) throw new AggregateError(errors, 'Deferred element disposal failed');
  }
}
