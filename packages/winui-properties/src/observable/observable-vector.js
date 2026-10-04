import {PropertyFault} from '../property/values.js';
import {propertyValuesEqual} from '../property/value-equality.js';
import {listenerToken, positiveLimit, restoreListeners, retainedListenerValues} from './listener-state.js';

export const CollectionChange = Object.freeze({Reset: 0, ItemInserted: 1, ItemRemoved: 2, ItemChanged: 3});
export const NotifyCollectionChangedAction = Object.freeze({Add: 0, Remove: 1, Replace: 2, Move: 3, Reset: 4});

/** Indexed collection emitting bounded incremental INCC/vector deltas. */
export class ObservableVector {
  constructor(items = [], {maxItems = 1000000, maxListeners = 100000, onDelta} = {}) {
    this.maxItems = positiveLimit(maxItems, 'vector capacity', {zero: true});
    this.maxListeners = positiveLimit(maxListeners, 'vector listener');
    this.values = this.materialize(items);
    this.onDelta = onDelta ?? (() => {});
    this.listeners = new Map();
    this.propertyListeners = new Map();
    this.nextToken = 1;
    this.version = 0;
    this.notifying = false;
    this.disposed = false;
  }

  get Count() { return this.values.length; }
  get length() { return this.values.length; }
  get subscriberCount() { return this.listeners.size + this.propertyListeners.size; }
  *[Symbol.iterator]() {
    const revision = this.version;
    for (let index = 0; index < this.Count; index++) {
      if (revision !== this.version) throw new PropertyFault('InvalidOperationException', 'The vector changed during enumeration');
      yield this.values[index];
    }
    if (revision !== this.version) throw new PropertyFault('InvalidOperationException', 'The vector changed during enumeration');
  }

  get_Item(index) {
    this.assertIndex(index);
    return this.values[index];
  }

  set_Item(index, value) {
    this.assertMutation();
    this.assertIndex(index);
    const previous = this.values[index];
    if (propertyValuesEqual(previous, value)) return;
    this.values[index] = value;
    this.publish('Replace', index, index, [value], [previous]);
  }

  Add(value) { this.Insert(this.values.length, value); }

  Insert(index, value) {
    this.assertMutation();
    this.assertIndex(index, true);
    if (this.values.length === this.maxItems) throw new RangeError('Vector capacity exceeded');
    this.values.splice(index, 0, value);
    this.publish('Add', index, -1, [value], []);
  }

  Remove(value) {
    this.assertMutation();
    const index = this.IndexOf(value);
    if (index < 0) return false;
    this.RemoveAt(index);
    return true;
  }

  RemoveAt(index) {
    this.assertMutation();
    this.assertIndex(index);
    this.publish('Remove', -1, index, [], this.values.splice(index, 1));
  }

  Move(oldIndex, newIndex) {
    this.assertMutation();
    this.assertIndex(oldIndex);
    this.assertIndex(newIndex);
    if (oldIndex === newIndex) return;
    const value = this.values.splice(oldIndex, 1)[0];
    this.values.splice(newIndex, 0, value);
    this.publish('Move', newIndex, oldIndex, [value], [value]);
  }

  Clear() { this.Reset([]); }
  Contains(value) { return this.IndexOf(value) >= 0; }
  IndexOf(value) { return this.values.findIndex(candidate => propertyValuesEqual(candidate, value)); }

  materialize(items) {
    const result = [];
    for (const item of items) {
      if (result.length >= this.maxItems) throw new RangeError('Vector capacity exceeded');
      result.push(item);
    }
    return result;
  }

  Reset(items) {
    this.assertMutation();
    const replacement = this.materialize(items);
    const previous = this.values;
    if (!replacement.length && !previous.length) return;
    this.values = replacement;
    this.publish('Reset', -1, -1, [...replacement], previous);
  }

  assertIndex(index, insertion = false) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.values.length + Number(insertion)) {
      throw new PropertyFault('ArgumentOutOfRangeException', 'Vector index is outside the collection');
    }
  }

  assertMutation() {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'ObservableVector has been disposed');
    if (this.notifying) throw new PropertyFault('InvalidOperationException', 'Cannot mutate a vector during its change notification');
    if (this.version >= Number.MAX_SAFE_INTEGER) throw new PropertyFault('InvalidOperationException', 'Vector version budget exceeded');
  }

  publish(action, newIndex, oldIndex, newItems, oldItems) {
    const change = Object.freeze({
      version: ++this.version,
      source: this,
      action,
      Action: NotifyCollectionChangedAction[action],
      NewStartingIndex: newIndex,
      OldStartingIndex: oldIndex,
      NewItems: Object.freeze(newItems),
      OldItems: Object.freeze(oldItems),
      CollectionChange: action === 'Add' ? 1 : action === 'Remove' ? 2 : action === 'Replace' ? 3 : 0,
      Index: Math.max(0, newIndex < 0 ? oldIndex : newIndex)
    });
    this.notifying = true;
    try {
      this.onDelta(change);
      for (const listener of [...this.listeners.values()]) listener(change);
      for (const listener of [...this.propertyListeners.values()]) {
        if (action !== 'Replace' && action !== 'Move') listener({propertyName: 'Count', source: this});
        listener({propertyName: 'Item[]', source: this});
      }
    } finally {
      this.notifying = false;
    }
  }

  subscribe(listener) {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'ObservableVector has been disposed');
    const token = listenerToken(this, listener, this.maxListeners);
    this.listeners.set(token, listener);
    return () => this.listeners.delete(token);
  }

  subscribePropertyChanged(listener) {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'ObservableVector has been disposed');
    const token = listenerToken(this, listener, this.maxListeners);
    this.propertyListeners.set(token, listener);
    return () => this.propertyListeners.delete(token);
  }

  *retainedValues() {
    yield* this.values;
    yield* retainedListenerValues(this.listeners.values());
    yield* retainedListenerValues(this.propertyListeners.values());
  }

  snapshot() {
    return {version: 1, items: [...this.values], revision: this.version, listeners: [...this.listeners],
      propertyListeners: [...this.propertyListeners], nextToken: this.nextToken, disposed: this.disposed};
  }

  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.items) || snapshot.items.length > this.maxItems
      || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || typeof snapshot.disposed !== 'boolean') {
      throw new PropertyFault('ArgumentException', 'Invalid vector snapshot');
    }
    const tokens = new Set();
    const listeners = restoreListeners(snapshot.listeners, snapshot.nextToken, this.maxListeners, tokens);
    const properties = restoreListeners(snapshot.propertyListeners, snapshot.nextToken, this.maxListeners - listeners.size, tokens);
    this.values = [...snapshot.items];
    this.version = snapshot.revision;
    this.listeners = listeners;
    this.propertyListeners = properties;
    this.nextToken = snapshot.nextToken;
    this.disposed = snapshot.disposed;
    this.notifying = false;
  }

  dispose() {
    this.disposed = true;
    this.listeners.clear();
    this.propertyListeners.clear();
    this.values.length = 0;
  }
}

/** Read-only adapter for IList/IVector hosts with explicit index and notification services. */
export function createVectorAdapter(source, {count, get, subscribe, version = () => 0, maxItems = 1000000}) {
  positiveLimit(maxItems, 'vector adapter capacity', {zero: true});
  const size = () => {
    const result = count(source);
    if (!Number.isSafeInteger(result) || result < 0 || result > maxItems) throw new RangeError('Vector adapter count limit');
    return result;
  };
  const item = index => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= size()) throw new PropertyFault('ArgumentOutOfRangeException', 'Vector adapter index');
    return get(source, index);
  };
  return Object.freeze({
    get Count() { return size(); },
    get_Item: item,
    subscribe(listener) { return subscribe(source, listener); },
    *[Symbol.iterator]() {
      const revision = version(source), length = size();
      for (let index = 0; index < length; index++) {
        if (revision !== version(source)) throw new PropertyFault('InvalidOperationException', 'The vector changed during enumeration');
        yield item(index);
      }
    }
  });
}
