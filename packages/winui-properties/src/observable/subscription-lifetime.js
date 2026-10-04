import {PropertyFault} from '../property/values.js';
import {positiveLimit, restoreListeners} from './listener-state.js';

/** Weak target lifetime; managed hosts inject their precise weak-handle implementation. */
export class SubscriptionLifetime {
  constructor(target, {createWeak = value => new WeakRef(value), dereference = handle => handle.deref(), release = () => {},
    maxSubscriptions = 100000} = {}) {
    if (!target || typeof target !== 'object') throw new TypeError('A subscription lifetime requires an object target');
    this.handle = createWeak(target);
    this.dereference = dereference;
    this.release = release;
    this.factories = new Map();
    this.active = new Map();
    this.loaded = false;
    this.disposed = false;
    this.nextToken = 1;
    this.maxSubscriptions = positiveLimit(maxSubscriptions, 'subscription lifetime');
  }

  /** A factory receives a weak-delivery function, so source handlers never capture the target. */
  add(factory, deliver) {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'Subscription lifetime is disposed');
    if (typeof factory !== 'function' || typeof deliver !== 'function') throw new TypeError('A subscription factory and delivery function are required');
    if (this.factories.size >= this.maxSubscriptions || this.nextToken >= Number.MAX_SAFE_INTEGER) throw new RangeError('Subscription lifetime limit');
    const token = this.nextToken++;
    this.factories.set(token, {factory, deliver});
    if (this.loaded) {
      try { this.attach(token); }
      catch (error) { this.factories.delete(token); throw error; }
    }
    return () => {
      const dispose = this.active.get(token);
      this.active.delete(token);
      this.factories.delete(token);
      dispose?.();
    };
  }

  attach(token) {
    const definition = this.factories.get(token);
    const listener = (...args) => {
      const target = this.dereference(this.handle);
      if (!target) {
        this.unload();
        return;
      }
      definition.deliver(target, ...args);
    };
    const dispose = definition.factory(listener);
    if (typeof dispose !== 'function') throw new TypeError('Subscription factory must return a disposer');
    this.active.set(token, dispose);
  }

  load() {
    if (this.disposed || this.loaded || !this.dereference(this.handle)) return;
    this.loaded = true;
    try {
      for (const token of this.factories.keys()) this.attach(token);
    } catch (error) {
      try { this.unload(); }
      catch (teardown) { throw new AggregateError([error, teardown], 'Subscription load and cleanup failed'); }
      throw error;
    }
  }

  unload() {
    this.loaded = false;
    const errors = [];
    const disposers = [...this.active.values()];
    this.active.clear();
    for (const dispose of disposers) {
      try { dispose(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Subscription teardown failed');
  }

  /** Hosts call sweep after collection; weak handles do not require finalizer timing. */
  sweep() {
    if (this.disposed || this.dereference(this.handle)) return false;
    this.dispose();
    return true;
  }

  snapshot() {
    return {version: 1, handle: this.handle, factories: [...this.factories], active: [...this.active],
      nextToken: this.nextToken, loaded: this.loaded, disposed: this.disposed};
  }

  /** Source subscriptions must be restored in the same host checkpoint; factories are never replayed. */
  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.factories) || snapshot.factories.length > this.maxSubscriptions
      || typeof snapshot.loaded !== 'boolean' || typeof snapshot.disposed !== 'boolean') throw new TypeError('Invalid subscription lifetime snapshot');
    const active = restoreListeners(snapshot.active, snapshot.nextToken, this.maxSubscriptions);
    const factories = new Map();
    for (const [token, definition] of snapshot.factories) {
      if (!Number.isSafeInteger(token) || token < 1 || token >= snapshot.nextToken || factories.has(token)
        || typeof definition?.factory !== 'function' || typeof definition?.deliver !== 'function') {
        throw new TypeError('Invalid subscription factory snapshot');
      }
      factories.set(token, definition);
    }
    if ([...active.keys()].some(token => !factories.has(token)) || !snapshot.loaded && active.size
      || snapshot.disposed && (factories.size || active.size || snapshot.handle !== null)) throw new TypeError('Invalid subscription lifecycle snapshot');
    this.handle = snapshot.handle;
    this.factories = factories;
    this.active = active;
    this.nextToken = snapshot.nextToken;
    this.loaded = snapshot.loaded;
    this.disposed = snapshot.disposed;
  }

  dispose() {
    if (this.disposed) return;
    try { this.unload(); } finally {
      this.disposed = true;
      this.factories.clear();
      this.release(this.handle);
      this.handle = null;
    }
  }
}
