import {ManagedFault, isReference} from '../heap.js';
import {managedBindingTypeName} from './member-access.js';

const elementLimit = 1000000;
const listenerLimit = 100000;
const actions = Object.freeze(['Add', 'Remove', 'Replace', 'Move', 'Reset']);
const signatures = Object.freeze({
  get_Count: 0, get_Item: 1, set_Item: 2, Add: 1, Insert: 2,
  Remove: 1, RemoveAt: 1, Clear: 0, IndexOf: 1, Contains: 1, get_IsReadOnly: 0
});

function findMethod(members, receiver, name, arity) {
  for (const type of members.ancestry(receiver)) {
    if (!type) continue;
    const direct = type.methods.get(name + ':' + arity);
    const candidates = direct ?? [...type.methods]
      .filter(([key]) => key.endsWith('.' + name + ':' + arity)).flatMap(([, values]) => values);
    const matches = candidates.filter(method => !method.isStatic && (name === 'get_Item' || name === 'set_Item'
      || name === 'Insert' || name === 'RemoveAt' ? managedBindingTypeName(method.parameters[0]) === 'int' : true));
    if (matches.length > 1) throw new ManagedFault('AmbiguousMatchException', 'The managed list member is ambiguous');
    if (matches.length) return matches[0];
  }
  return null;
}

function listMethods(members, receiver) {
  const count = findMethod(members, receiver, 'get_Count', 0);
  const item = findMethod(members, receiver, 'get_Item', 1);
  if (!count || !item || managedBindingTypeName(count.returnType) !== 'int') return null;
  const methods = {get_Count: count, get_Item: item};
  for (const [name, arity] of Object.entries(signatures)) {
    if (!Object.hasOwn(methods, name)) methods[name] = findMethod(members, receiver, name, arity);
  }
  return Object.freeze(methods);
}

/** Indexed managed IList projection. It never replaces managed storage with a native array. */
class ManagedListProjection {
  constructor({context, members, events, receiver, methods, project}) {
    this.context = context;
    this.members = members;
    this.events = events;
    this.heap = context.platform.heap;
    this.source = this.heap.createHandle(receiver, {weak: true});
    this.methods = methods;
    this.project = project;
    this.listeners = new Map();
    this.nextToken = 1;
    this.version = 0;
    this.disposed = false;
    this.owner = Object.freeze({});
    this.subscription = null;
    try { this.subscription = events.subscribe(receiver, 'CollectionChanged', (sender, argument) => this.changed(argument)); }
    catch (error) { this.heap.releaseHandle(this.source); throw error; }
  }

  receiver() {
    const source = this.disposed ? null : this.heap.getHandle(this.source);
    if (!source) throw new ManagedFault('ObjectDisposedException', 'The managed list source is no longer alive');
    return source;
  }

  invoke(name, args = []) {
    const method = this.methods[name];
    if (!method) throw new ManagedFault('NotSupportedException', 'The managed list does not implement ' + name);
    return this.members.invoke(this.receiver(), method, args);
  }

  get Count() {
    const count = this.invoke('get_Count');
    if (!Number.isSafeInteger(count) || count < 0 || count > elementLimit) {
      throw new ManagedFault('ExecutionLimitException', 'Managed list count is outside the supported capacity');
    }
    return count;
  }
  get length() { return this.Count; }
  get IsReadOnly() { return this.methods.get_IsReadOnly ? this.invoke('get_IsReadOnly') : !this.methods.set_Item; }

  index(index, insert = false) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.Count + Number(insert)) {
      throw new ManagedFault('ArgumentOutOfRangeException', 'Managed list index is outside the collection');
    }
  }
  get_Item(index) { this.index(index); return this.invoke('get_Item', [index]); }

  mutate(name, args) {
    if (this.IsReadOnly) throw new ManagedFault('NotSupportedException', 'The managed list is read-only');
    if (this.delivering) throw new ManagedFault('InvalidOperationException', 'Cannot mutate a list during its notification');
    this.context.sceneJournal?.captureModel(this);
    const version = this.version;
    const value = this.invoke(name, args);
    if (this.version === version) this.advanceVersion();
    return value;
  }
  set_Item(index, value) { this.index(index); return this.mutate('set_Item', [index, value]); }
  Insert(index, value) { this.index(index, true); return this.mutate('Insert', [index, value]); }
  Add(value) {
    if (this.Count >= elementLimit) throw new RangeError('Managed list capacity exceeded');
    return this.mutate('Add', [value]);
  }
  RemoveAt(index) { this.index(index); return this.mutate('RemoveAt', [index]); }
  Remove(value) { return this.mutate('Remove', [value]); }
  Clear() { return this.mutate('Clear', []); }
  IndexOf(value) { return this.invoke('IndexOf', [value]); }
  Contains(value) { return this.methods.Contains ? this.invoke('Contains', [value]) : this.IndexOf(value) >= 0; }

  *[Symbol.iterator]() {
    const revision = this.version;
    const count = this.Count;
    for (let index = 0; index < count; index++) {
      if (revision !== this.version || this.Count !== count) {
        throw new ManagedFault('InvalidOperationException', 'The managed list changed during enumeration');
      }
      yield this.invoke('get_Item', [index]);
    }
  }

  subscribe(callback) {
    this.receiver();
    if (typeof callback !== 'function') throw new TypeError('Managed list listener must be callable');
    if (this.listeners.size >= listenerLimit || this.nextToken >= Number.MAX_SAFE_INTEGER) throw new RangeError('Managed list listener limit');
    const token = this.nextToken++;
    this.listeners.set(token, callback);
    return () => { if (this.listeners.get(token) === callback) this.listeners.delete(token); };
  }

  subscribePropertyChanged(callback) {
    const changed = change => {
      if (change.action !== 'Replace' && change.action !== 'Move') callback({source: this, propertyName: 'Count'});
      callback({source: this, propertyName: 'Item[]'});
    };
    if (callback.retainedValues) changed.retainedValues = () => callback.retainedValues();
    return this.subscribe(changed);
  }

  value(argument, name) {
    const model = this.context.unwrapModel(argument);
    if (model?.values && Object.hasOwn(model.values, name)) return model.values[name];
    const member = this.members.named(argument, name);
    return member ? this.members.read(argument, member) : this.context.native(this.context.read(argument, name));
  }

  values(reference) {
    if (reference === null || reference === undefined) return null;
    const model = this.context.unwrapModel(reference);
    const source = Array.isArray(model) || model?.[Symbol.iterator] ? model
      : this.project(reference) ?? this.context.items(reference);
    const result = [];
    for (const value of source) {
      if (result.length >= elementLimit) throw new ManagedFault('ExecutionLimitException', 'Managed change payload capacity exceeded');
      result.push(value);
    }
    return Object.freeze(result);
  }

  advanceVersion() {
    if (this.version >= Number.MAX_SAFE_INTEGER) throw new ManagedFault('ExecutionLimitException', 'Managed list version exhausted');
    this.version++;
  }

  changed(argument) {
    const action = this.value(argument, 'Action');
    const newIndex = this.value(argument, 'NewStartingIndex');
    const oldIndex = this.value(argument, 'OldStartingIndex');
    if (!Number.isInteger(action) || !actions[action]
      || ![newIndex, oldIndex].every(index => Number.isSafeInteger(index) && index >= -1 && index <= elementLimit)) {
      throw new ManagedFault('ArgumentException', 'Invalid managed collection notification');
    }
    const newItems = this.values(this.value(argument, 'NewItems'));
    const oldItems = this.values(this.value(argument, 'OldItems'));
    const unknownIndex = action !== 4 && (action !== 1 && newIndex < 0 || action !== 0 && oldIndex < 0);
    const effectiveAction = unknownIndex ? 4 : action;
    const change = Object.freeze({source: this, action: actions[effectiveAction], Action: effectiveAction,
      NewItems: newItems, OldItems: oldItems, NewStartingIndex: newIndex, OldStartingIndex: oldIndex,
      CollectionChange: [1, 2, 3, 0, 0][effectiveAction], Index: Math.max(0, effectiveAction === 1 ? oldIndex : newIndex)});
    this.context.sceneJournal?.captureModel(this);
    this.advanceVersion();
    this.delivering = true;
    try { for (const callback of [...this.listeners.values()]) callback(change); }
    finally { this.delivering = false; }
  }

  *retainedValues() {
    if (this.disposed) return;
    yield this.heap.getHandle(this.source);
    for (const listener of this.listeners.values()) if (listener.retainedValues) yield* listener.retainedValues();
  }
  snapshot() {
    return {version: 1, owner: this.owner, revision: this.version, source: this.source, subscription: this.subscription,
      nextToken: this.nextToken, listeners: [...this.listeners], disposed: this.disposed};
  }
  restore(snapshot) {
    if (snapshot?.version !== 1 || snapshot.owner !== this.owner || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
      || !Number.isSafeInteger(snapshot.nextToken) || snapshot.nextToken < 1 || !Array.isArray(snapshot.listeners)
      || snapshot.listeners.length > listenerLimit || typeof snapshot.disposed !== 'boolean'
      || snapshot.source?.owner !== this.heap.handleOwner || snapshot.subscription !== null && typeof snapshot.subscription !== 'function') {
      throw new TypeError('Invalid managed list snapshot');
    }
    const listeners = new Map();
    for (const entry of snapshot.listeners) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]) || entry[0] < 1
        || entry[0] >= snapshot.nextToken || listeners.has(entry[0]) || typeof entry[1] !== 'function') {
        throw new TypeError('Invalid managed list listener snapshot');
      }
      listeners.set(...entry);
    }
    this.source = snapshot.source;
    this.subscription = snapshot.subscription;
    this.version = snapshot.revision;
    this.nextToken = snapshot.nextToken;
    this.listeners = listeners;
    this.disposed = snapshot.disposed;
    this.delivering = false;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try { this.subscription?.(); }
    finally { this.subscription = null; this.heap.releaseHandle(this.source); this.listeners.clear(); }
  }
}

/** Resolve each managed list type once. Source-owned model state participates in normal GC and rewind. */
export function createManagedCollectionProjector(context, members, events) {
  const descriptors = new Map();
  const project = receiver => {
    if (!isReference(receiver)) return null;
    const type = context.typeOf(receiver);
    if (!descriptors.has(type)) {
      if (descriptors.size >= members.maxMembers) throw new ManagedFault('ExecutionLimitException', 'Managed list type budget exceeded');
      descriptors.set(type, listMethods(members, receiver));
    }
    const methods = descriptors.get(type);
    if (!methods) return null;
    return context.state(receiver, 'managedListProjection', () => new ManagedListProjection({context, members, events, receiver, methods, project}));
  };
  return project;
}
