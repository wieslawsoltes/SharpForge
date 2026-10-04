import {ChangeNotificationQueue} from './change-queue.js';
import {PropertyFault} from '../property/values.js';
import {propertyValuesEqual} from '../property/value-equality.js';
import {listenerToken, positiveLimit, restoreListeners, retainedListenerValues, inheritListenerRoots} from './listener-state.js';

/** Explicit observable data source; arbitrary objects are never monkey-patched. */
export class ObservableObject {
  constructor(values = {}, {queue, equals = propertyValuesEqual, maxProperties = 100000, maxListeners = 100000} = {}) {
    this.maxProperties = positiveLimit(maxProperties, 'observable property');
    this.maxListeners = positiveLimit(maxListeners, 'observable listener');
    this.values = new Map(Object.entries(values));
    if (this.values.size > this.maxProperties) throw new RangeError('Observable property limit');
    for (const name of this.values.keys()) this.assertName(name);
    this.queue = queue ?? new ChangeNotificationQueue();
    this.ownsQueue = !queue;
    this.equals = equals;
    if (typeof equals !== 'function') throw new TypeError('Observable equality must be callable');
    this.listeners = new Map();
    this.keys = new Map();
    this.nextToken = 1;
    this.disposed = false;
    this.dispatch = change => {
      if (this.disposed) return;
      for (const listener of [...this.listeners.values()]) listener(change);
    };
  }

  get(name) {
    return this.values.get(name);
  }

  has(name) {
    return this.values.has(name);
  }

  /** Raise INPC-compatible changes only when the value changes. */
  set(name, value) {
    this.assertLive();
    this.assertName(name);
    if (!this.values.has(name) && this.values.size >= this.maxProperties) throw new RangeError('Observable property limit');
    const oldValue = this.values.get(name);
    if (this.values.has(name) && this.equals(oldValue, value)) return false;
    if (!this.keys.has(name) && this.keys.size >= this.maxProperties) throw new RangeError('Observable notification key limit');
    this.values.set(name, value);
    this.notify(name, oldValue, value);
    return true;
  }

  /** An empty or null name invalidates every binding on this source. */
  notify(propertyName = '', oldValue, newValue) {
    this.assertLive();
    propertyName ??= '';
    this.assertName(propertyName);
    let key = this.keys.get(propertyName);
    if (!key) {
      if (this.keys.size >= this.maxProperties) throw new RangeError('Observable notification key limit');
      key = {};
      this.keys.set(propertyName, key);
    }
    this.queue.enqueue(key, this.dispatch, {source: this, propertyName, PropertyName: propertyName, oldValue, newValue});
  }

  subscribe(listener) {
    this.assertLive();
    const token = listenerToken(this, listener, this.maxListeners);
    this.listeners.set(token, listener);
    return () => this.listeners.delete(token);
  }

  get subscriberCount() {
    return this.listeners.size;
  }

  assertLive() {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'ObservableObject has been disposed');
  }

  assertName(name) {
    if (typeof name !== 'string' || name.length > 512) throw new TypeError('Observable property names must be bounded strings');
  }

  *retainedValues() { yield* this.values.values(); yield* retainedListenerValues(this.listeners.values()); }

  snapshot() {
    return {version: 1, values: [...this.values], listeners: [...this.listeners], keys: [...this.keys],
      nextToken: this.nextToken, disposed: this.disposed, queue: this.ownsQueue ? this.queue.snapshot() : null};
  }

  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.values) || !Array.isArray(snapshot.keys)
      || snapshot.values.length > this.maxProperties || snapshot.keys.length > this.maxProperties
      || typeof snapshot.disposed !== 'boolean') throw new TypeError('Invalid observable object snapshot');
    const values = new Map(snapshot.values), keys = new Map(snapshot.keys);
    if (values.size !== snapshot.values.length || keys.size !== snapshot.keys.length) throw new TypeError('Duplicate observable snapshot property');
    for (const name of [...values.keys(), ...keys.keys()]) this.assertName(name);
    const listeners = restoreListeners(snapshot.listeners, snapshot.nextToken, this.maxListeners);
    if (this.ownsQueue) this.queue.restore(snapshot.queue);
    this.values = values;
    this.keys = keys;
    this.listeners = listeners;
    this.nextToken = snapshot.nextToken;
    this.disposed = snapshot.disposed;
  }

  dispose() {
    this.disposed = true;
    for (const key of this.keys.values()) this.queue.cancel(key);
    if (this.ownsQueue) this.queue.dispose();
    this.listeners.clear();
    this.keys.clear();
    this.values.clear();
  }
}

/** Adapt managed INPC or a JS source to a single property-filtered subscription. */
export function subscribePropertyChanged(source, propertyName, listener, services = {}) {
  const changed = event => {
    const name = event?.propertyName ?? event?.PropertyName ?? '';
    if (!name || name === propertyName || name === 'Item[]' && propertyName === 'Item') listener(event);
  };
  inheritListenerRoots(changed, listener);
  if (services.subscribePropertyChanged) return services.subscribePropertyChanged(source, changed);
  if (source instanceof ObservableObject) return source.subscribe(changed);
  if (typeof source?.subscribePropertyChanged === 'function') return source.subscribePropertyChanged(changed);
  return () => {};
}
