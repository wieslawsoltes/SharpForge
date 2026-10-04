import {PropertyFault} from '../../property/values.js';
import {CompiledBindings} from './executor.js';

/** Target-owned groups retain values; a root's generated Bindings facade only keeps weak controllers. */
export class CompiledBindingGroup {
  constructor({weak = false, maxBindings = 10000} = {}) {
    if (!Number.isSafeInteger(maxBindings) || maxBindings < 1 || maxBindings > 1000000) throw new RangeError('Invalid binding group budget');
    this.weak = weak;
    this.maxBindings = maxBindings;
    this.entries = new Map();
    this.nextToken = 1;
    this.disposed = false;
  }

  add(controller) {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'Compiled binding group is disposed');
    if (!(controller instanceof CompiledBindings)) throw new TypeError('A compiled binding controller is required');
    this.prune();
    if (this.entries.size >= this.maxBindings || this.nextToken >= Number.MAX_SAFE_INTEGER) throw new RangeError('Compiled binding group exceeded');
    const token = this.nextToken++;
    this.entries.set(token, this.weak ? new WeakRef(controller) : controller);
    return token;
  }

  remove(token) { return this.entries.delete(token); }
  value(entry) { return this.weak ? entry.deref() : entry; }
  prune() {
    for (const [token, entry] of this.entries) {
      const value = this.value(entry);
      if (!value || value.disposed) this.entries.delete(token);
    }
  }

  visit(action) {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'Compiled binding group is disposed');
    const errors = [];
    this.prune();
    for (const entry of this.entries.values()) {
      const value = this.value(entry);
      if (value) { try { action(value); } catch (error) { errors.push(error); } }
    }
    if (errors.length) throw new AggregateError(errors, 'Compiled binding group operation failed');
  }

  Initialize() { this.visit(controller => controller.Initialize()); }
  Update() { this.visit(controller => controller.Update()); }
  StopTracking() { this.visit(controller => controller.StopTracking()); }

  *retainedValues() {
    if (!this.weak) for (const entry of this.entries.values()) yield* entry.retainedValues();
  }

  snapshot() {
    return {version: 1, weak: this.weak, disposed: this.disposed, nextToken: this.nextToken,
      entries: [...this.entries].map(([token, entry]) => ({token, entry, state: this.weak ? null : entry.snapshot()}))};
  }

  restore(snapshot) {
    if (snapshot?.version !== 1 || snapshot.weak !== this.weak || !Array.isArray(snapshot.entries)
      || snapshot.entries.length > this.maxBindings || !Number.isSafeInteger(snapshot.nextToken) || snapshot.nextToken < 1
      || snapshot.entries.some(item => !Number.isSafeInteger(item.token) || item.token < 1 || item.token >= snapshot.nextToken
        || !(item.entry instanceof (this.weak ? WeakRef : CompiledBindings)))
      || new Set(snapshot.entries.map(item => item.token)).size !== snapshot.entries.length) {
      throw new TypeError('Invalid compiled binding group snapshot');
    }
    if (!this.weak) {
      const saved = new Set(snapshot.entries.map(item => item.entry));
      for (const entry of this.entries.values()) if (!saved.has(entry)) entry.disposeForRestore();
    }
    this.disposed = snapshot.disposed;
    this.nextToken = snapshot.nextToken;
    this.entries = new Map(snapshot.entries.map(item => [item.token, item.entry]));
    if (!this.weak) for (const item of snapshot.entries) item.entry.restore(item.state);
  }

  Dispose() {
    if (this.disposed) return;
    try { this.visit(controller => controller.Dispose()); }
    finally { this.entries.clear(); this.disposed = true; }
  }
  dispose() { this.Dispose(); }
}

/** A XAML root lifetime must not retain a removed target through a native controller closure. */
export class CompiledBindingLifetime {
  constructor(initialize) {
    if (typeof initialize !== 'function') throw new TypeError('A compiled binding initializer is required');
    this.initialize = initialize;
    this.controller = null;
    this.registrations = [];
    this.disposed = false;
  }

  attach() {
    if (this.disposed || !this.initialize) return;
    const initialize = this.initialize;
    this.initialize = null;
    const {controller, groups, run = action => action()} = initialize();
    this.controller = new WeakRef(controller);
    try {
      run(() => {
        if (!Array.isArray(groups) || groups.length > 2) throw new TypeError('Compiled bindings require bounded owner groups');
        for (const group of groups) this.registrations.push({group: new WeakRef(group), token: group.add(controller)});
        controller.Initialize();
      });
    } catch (error) {
      try { this.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Compiled XAML initialization failed'); }
      throw error;
    }
  }

  *retainedValues() {}
  snapshot() {
    return {version: 1, initialize: this.initialize, controller: this.controller,
      registrations: [...this.registrations], disposed: this.disposed};
  }
  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.registrations) || snapshot.registrations.length > 2) {
      throw new TypeError('Invalid compiled XAML lifetime snapshot');
    }
    this.initialize = snapshot.initialize;
    this.controller = snapshot.controller;
    this.registrations = [...snapshot.registrations];
    this.disposed = snapshot.disposed;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.initialize = null;
    try { this.controller?.deref()?.Dispose(); }
    finally {
      for (const entry of this.registrations) entry.group.deref()?.remove(entry.token);
      this.registrations = [];
      this.controller = null;
    }
  }
}
