import {PropertyFault} from '../property/values.js';
import {propertyValuesEqual} from '../property/value-equality.js';
import {ObservableVector} from './observable-vector.js';
import {ObservableEventArguments} from './event-arguments.js';
import {vectorElementTypes} from '../contracts/property-vectors.js';
import {retainedListenerValues, inheritListenerRoots} from './listener-state.js';
import {registerListAdapters} from './list-adapters.js';

const prefix = 'Windows.Foundation.Collections.';
const elementLimit = 1000000;

class VectorChangeSource {
  constructor(context, receiver) {
    this.context = context;
    this.receiver = receiver;
    this.handlers = [];
    this.listeners = new Map();
    this.nextToken = 1;
    this.disposed = false;
    this.delivering = false;
  }
  add(callback) {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'Vector subscriptions are disposed');
    if (this.handlers.length >= 100000) throw new RangeError('Vector event subscriber limit');
    this.context.sceneJournal?.captureModel(this);
    this.handlers.push(callback);
  }
  remove(callback) {
    for (let index = this.handlers.length - 1; index >= 0; index--) {
      if (propertyValuesEqual(this.handlers[index], callback)) {
        this.context.sceneJournal?.captureModel(this);
        this.handlers.splice(index, 1);
        return;
      }
    }
  }
  subscribe(callback) {
    if (this.disposed || typeof callback !== 'function') throw new TypeError('A live vector listener is required');
    if (this.listeners.size >= 100000 || this.nextToken >= Number.MAX_SAFE_INTEGER) throw new RangeError('Vector listener limit');
    const token = this.nextToken++;
    this.listeners.set(token, callback);
    return () => this.listeners.delete(token);
  }
  publish(change) {
    if (this.disposed) return;
    if (this.delivering) throw new PropertyFault('InvalidOperationException', 'Cannot reenter a vector notification');
    this.delivering = true;
    try {
      for (const listener of [...this.listeners.values()]) listener(change);
      if (!this.handlers.length) return;
      const argument = this.context.wrapModel(new ObservableEventArguments({CollectionChange: change.CollectionChange, Index: change.Index}),
        prefix + 'VectorChangedEventArgs');
      for (const handler of [...this.handlers]) this.context.invokeManaged(handler, [this.receiver, argument]);
    } finally { this.delivering = false; }
  }
  *retainedValues() { yield* this.handlers; yield* retainedListenerValues(this.listeners.values()); }
  snapshot() {
    return {version: 1, handlers: [...this.handlers], listeners: [...this.listeners], nextToken: this.nextToken, disposed: this.disposed};
  }
  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.handlers) || !Array.isArray(snapshot.listeners)
      || snapshot.handlers.length > 100000 || snapshot.listeners.length > 100000 || typeof snapshot.disposed !== 'boolean'
      || !Number.isSafeInteger(snapshot.nextToken) || snapshot.nextToken < 1) throw new TypeError('Invalid vector subscription snapshot');
    const listeners = new Map();
    for (const entry of snapshot.listeners) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]) || entry[0] < 1
        || entry[0] >= snapshot.nextToken || listeners.has(entry[0]) || typeof entry[1] !== 'function') {
        throw new TypeError('Invalid vector listener snapshot');
      }
      listeners.set(...entry);
    }
    this.handlers = [...snapshot.handlers];
    this.listeners = listeners;
    this.nextToken = snapshot.nextToken;
    this.disposed = snapshot.disposed;
    this.delivering = false;
  }
  dispose() { this.disposed = true; this.handlers.length = 0; this.listeners.clear(); }
}

/** The authoritative host collection owns storage, accounting, scene deltas and mutation rollback. */
export class FrameworkVectorAdapter {
  constructor(context, receiver) { this.context = context; this.receiver = receiver; }
  get reconstructible() { return true; }
  get Count() { return this.context.items(this.receiver).length; }
  get length() { return this.Count; }
  get version() { return this.context.collectionVersion(this.receiver); }
  get_Item(index) {
    this.index(index);
    return this.context.items(this.receiver)[index];
  }
  subscribePropertyChanged(callback) {
    return this.subscribe(inheritListenerRoots(change => {
      if (change.action !== 'Replace' && change.action !== 'Move') callback({propertyName: 'Count', source: this});
      callback({propertyName: 'Item[]', source: this});
    }, callback));
  }
  index(index, insert = false) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.Count + Number(insert)) {
      throw new PropertyFault('ArgumentOutOfRangeException', 'Vector index is outside the collection');
    }
  }
  *[Symbol.iterator]() {
    const version = this.version;
    for (let index = 0; index < this.Count; index++) {
      if (version !== this.version) throw new PropertyFault('InvalidOperationException', 'The vector changed during enumeration');
      yield this.get_Item(index);
    }
  }
  subscribe(callback) { return vectorChangesFor(this.context, this.receiver).subscribe(callback); }
  operation(name, args) {
    const changes = vectorChangesFor(this.context, this.receiver, false);
    if (changes?.delivering) throw new PropertyFault('InvalidOperationException', 'Cannot mutate a vector during notification');
    if (!this.context.collectionOperation) throw new PropertyFault('NotSupportedException', 'The host collection operation service is unavailable');
    return this.context.collectionOperation(this.receiver, name, args);
  }
  set_Item(index, value) { this.index(index); return this.operation('set_Item', [index, value]); }
  Insert(index, value) { this.index(index, true); return this.operation('Insert', [index, value]); }
  Add(value) { return this.Insert(this.Count, value); }
  RemoveAt(index) { this.index(index); return this.operation('RemoveAt', [index]); }
  Clear() { return this.operation('Clear', []); }
  IndexOf(value) { return this.context.items(this.receiver).findIndex(candidate => propertyValuesEqual(candidate, value)); }
  Contains(value) { return this.IndexOf(value) >= 0; }
  Remove(value) {
    const index = this.IndexOf(value);
    if (index < 0) return false;
    this.RemoveAt(index);
    return true;
  }
  Move(from, to) { this.index(from); this.index(to); return this.operation('Move', [from, to]); }
  ReplaceAll(values) {
    if (!Array.isArray(values) || values.length > elementLimit) throw new RangeError('Vector replacement limit');
    return this.operation('ReplaceAll', [values]);
  }
}

class VectorView {
  constructor(values) {
    const result = [];
    for (const value of values) {
      if (result.length >= elementLimit) throw new RangeError('Vector view capacity exceeded');
      result.push(value);
    }
    this.values = Object.freeze(result);
  }
  get Count() { return this.values.length; }
  get_Item(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.Count) throw new PropertyFault('ArgumentOutOfRangeException', 'Vector view index');
    return this.values[index];
  }
  IndexOf(value) { return this.values.findIndex(candidate => propertyValuesEqual(candidate, value)); }
  *[Symbol.iterator]() { yield* this.values; }
  *retainedValues() { yield* this.values; }
  snapshot() { return {version: 1, values: this.values}; }
  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.values) || snapshot.values.length > elementLimit) throw new TypeError('Invalid vector view snapshot');
    this.values = Object.freeze([...snapshot.values]);
  }
}

export function vectorChangesFor(context, receiver, create = true) {
  return context.state(receiver, 'vectorChanges', create ? () => new VectorChangeSource(context, receiver) : undefined);
}

export function vectorFor(context, receiver) {
  const model = context.model?.(receiver) ?? context.unwrapModel(receiver);
  return model instanceof ObservableVector || model instanceof VectorView ? model
    : context.state(receiver, 'frameworkVector', () => new FrameworkVectorAdapter(context, receiver));
}

/** Called once by the authoritative host collection after storage and scene deltas commit. */
export function publishVectorChange(context, receiver, change) {
  vectorChangesFor(context, receiver, false)?.publish(change);
  if (!context.isAlive || context.isAlive(receiver)) context.syncOwner?.(receiver);
}

export function initializeVectorContext(context) {
  context.vectorFor = receiver => vectorFor(context, receiver);
  context.vectorChanged = (receiver, change) => publishVectorChange(context, receiver, change);
}

function getMany(context, receiver, start, buffer) {
  const vector = vectorFor(context, receiver);
  if (!Number.isSafeInteger(start) || start < 0 || start > vector.Count) throw new PropertyFault('ArgumentOutOfRangeException', 'Vector start index');
  const capacity = context.items(buffer).length;
  if (capacity > elementLimit) throw new RangeError('Vector buffer limit');
  const length = Math.min(capacity, vector.Count - start);
  for (let index = 0; index < length; index++) {
    context.getBindingOperations().services.write(buffer, {kind: 'index', key: index}, vector.get_Item(start + index));
  }
  return length;
}

function operation({context, receiver, descriptor, args}) {
  const vector = vectorFor(context, receiver);
  const name = descriptor.name;
  if (name === 'get_Size') return vector.Count;
  if (name === 'GetAt') return context.managed(vector.get_Item(context.native(args[0])), descriptor.result);
  if (name === 'IndexOf') {
    const found = vector.IndexOf(context.properties.toNative(args[0], descriptor.parameters[0]));
    context.writeReference(args[1], Math.max(found, 0));
    return found >= 0;
  }
  if (name === 'GetMany') return getMany(context, receiver, context.native(args[0]), args[1]);
  if (name === 'GetView') return context.wrapModel(new VectorView(vector), descriptor.result);
  if (vector.snapshot) context.sceneJournal?.captureModel(vector);
  if (name === 'SetAt' || name === 'set_Item' || name === 'InsertAt') {
    const value = context.properties.toNative(args[1], descriptor.parameters[1]);
    return name === 'InsertAt' ? vector.Insert(context.native(args[0]), value) : vector.set_Item(context.native(args[0]), value);
  }
  if (name === 'RemoveAt') return vector.RemoveAt(context.native(args[0]));
  if (name === 'Append') return vector.Add(context.properties.toNative(args[0], descriptor.parameters[0]));
  if (name === 'RemoveAtEnd') return vector.RemoveAt(vector.Count - 1);
  if (name === 'Clear') return vector.Clear();
  if (name === 'ReplaceAll') {
    const items = context.items(args[0]);
    if (items.length > elementLimit) throw new RangeError('Vector replacement limit');
    const elementType = descriptor.parameters[0].slice(0, -2);
    const values = items.map(value => context.properties.toNative(value, elementType));
    return vector instanceof ObservableVector ? vector.Reset(values) : vector.ReplaceAll(values);
  }
  throw new PropertyFault('MissingMethodException', 'Unknown vector operation');
}

export function registerVectorAdapters(registry) {
  registerListAdapters(registry, vectorFor);
  const read = ['GetAt', 'IndexOf', 'GetMany'];
  const write = ['GetView', 'SetAt', 'InsertAt', 'RemoveAt', 'Append', 'RemoveAtEnd', 'Clear', 'ReplaceAll'];
  for (const element of vectorElementTypes) {
    for (const family of ['IVectorView', 'IVector', 'IObservableVector']) {
      const owner = prefix + `${family}\`1<${element}>`;
      registry.register({owner, kind: 'get', name: 'get_Size'}, operation);
      for (const name of family === 'IVectorView' ? read : [...read, ...write]) {
        registry.register({owner, name, arity: name === 'IndexOf' ? 2 : '*'}, operation);
      }
    }
    registerEvent(registry, prefix + `IObservableVector\`1<${element}>`);
  }
  for (const owner of ['Microsoft.UI.Xaml.Controls.ItemCollection', 'Microsoft.UI.Xaml.Controls.UIElementCollection']) {
    registry.register({owner, kind: 'get', name: 'get_Size'}, operation);
    for (const name of [...read, ...write.filter(name => name !== 'Clear'), 'set_Item']) {
      registry.register({owner, name, arity: name === 'IndexOf' ? 2 : '*'}, operation);
    }
    registerEvent(registry, owner);
  }
  for (const owner of [prefix + 'VectorChangedEventArgs', prefix + 'IVectorChangedEventArgs']) {
    for (const name of ['CollectionChange', 'Index']) registry.register({owner, kind: 'get', name: 'get_' + name}, ({context, receiver}) => {
      return context.unwrapModel(receiver).values[name];
    });
  }
}

function registerEvent(registry, owner) {
  registry.register({owner, kind: 'eventAdd', name: 'add_VectorChanged'}, ({context, receiver, args}) => {
    vectorChangesFor(context, receiver).add(args[0]);
  });
  registry.register({owner, kind: 'eventRemove', name: 'remove_VectorChanged'}, ({context, receiver, args}) => {
    vectorChangesFor(context, receiver, false)?.remove(args[0]);
  });
}
