import {ResourceFault} from '../resources/errors.js';

/** Per-instance O(1) name lookup; nested scopes never leak sibling template names. */
export class NameScope {
  constructor({owner = null, parent = null, maxNames = 100000} = {}) {
    this.owner = owner;
    this.parent = parent;
    this.maxNames = maxNames;
    this.names = new Map();
    this.deferred = new Map();
    this.keys = new Set();
    this.listeners = new Map();
    this.disposed = false;
  }

  registerName(name, value) {
    if (this.disposed) throw new ResourceFault('SFTPL001', 'Cannot register into a disposed namescope.');
    if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)) throw new ResourceFault('SFTPL002', `Invalid XAML name '${name}'.`);
    if (this.names.has(name)) throw new ResourceFault('SFTPL003', `Duplicate name '${name}' in this namescope.`);
    if (!this.keys.has(name) && this.keys.size >= this.maxNames) throw new ResourceFault('SFTPL004', 'Namescope size limit exceeded.');
    this.keys.add(name);
    this.names.set(name, value);
    this.emit(name, value);
  }

  unregisterName(name) {
    const removed = this.names.delete(name);
    if (!this.deferred.has(name)) this.keys.delete(name);
    if (removed) this.emit(name, null);
    return removed;
  }

  registerDeferred(name, realize) {
    if (this.disposed) throw new ResourceFault('SFTPL001', 'Cannot register into a disposed namescope.');
    if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) || typeof realize !== 'function') throw new ResourceFault('SFTPL002', 'Invalid deferred name.');
    if (this.keys.has(name)) throw new ResourceFault('SFTPL003', `Duplicate name '${name}' in this namescope.`);
    if (this.keys.size >= this.maxNames) throw new ResourceFault('SFTPL004', 'Namescope size limit exceeded.');
    const entry = {realize, loading: false};
    this.deferred.set(name, entry);
    this.keys.add(name);
    return () => {
      if (this.deferred.get(name) !== entry) return;
      this.deferred.delete(name);
      if (!this.names.has(name)) this.keys.delete(name);
    };
  }

  findName(name, {searchParents = false, realize = true} = {}) {
    if (this.disposed) return null;
    if (this.names.has(name)) return this.names.get(name);
    const deferred = this.deferred.get(name);
    if (deferred && realize) {
      if (deferred.loading) throw new ResourceFault('SFTPL019', 'Recursive deferred-name realization.');
      deferred.loading = true;
      try { return deferred.realize() ?? null; } finally { deferred.loading = false; }
    }
    return searchParents ? this.parent?.findName(name, {searchParents, realize}) ?? null : null;
  }

  peekName(name) { return this.disposed ? null : this.names.get(name) ?? null; }

  subscribe(name, listener) {
    if (this.disposed) throw new ResourceFault('SFTPL001', 'Cannot observe a disposed namescope.');
    let listeners = this.listeners.get(name);
    if (!listeners) this.listeners.set(name, listeners = new Set());
    listeners.add(listener);
    return () => {
      const current = this.listeners.get(name);
      current?.delete(listener);
      if (!current?.size) this.listeners.delete(name);
    };
  }

  emit(name, value) {
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener(value);
  }

  *retainedValues() {
    yield this.owner; yield* this.names.values();
    for (const entry of this.deferred.values()) if (entry.realize.retainedValues) yield* entry.realize.retainedValues();
  }
  snapshot() {
    if ([...this.deferred.values()].some(entry => entry.loading)) throw new ResourceFault('SFTPL019', 'Cannot snapshot a realizing namescope.');
    return {owner: this.owner, parent: this.parent, names: new Map(this.names), deferred: new Map(this.deferred),
      listeners: new Map([...this.listeners].map(([name, values]) => [name, new Set(values)])), disposed: this.disposed};
  }
  restore(snapshot) {
    this.owner = snapshot.owner;
    this.parent = snapshot.parent;
    this.names = new Map(snapshot.names);
    this.deferred = new Map(snapshot.deferred ?? []);
    this.keys = new Set([...this.names.keys(), ...this.deferred.keys()]);
    this.listeners = new Map([...(snapshot.listeners ?? [])].map(([name, values]) => [name, new Set(values)]));
    this.disposed = snapshot.disposed ?? false;
  }

  dispose({preserveValues = false} = {}) {
    if (this.disposed) return;
    this.disposed = true;
    const names = [...this.names.keys()];
    this.names.clear();
    this.deferred.clear();
    this.keys.clear();
    if (!preserveValues) for (const name of names) this.emit(name, null);
    this.listeners.clear();
    this.owner = null;
    this.parent = null;
  }
}
