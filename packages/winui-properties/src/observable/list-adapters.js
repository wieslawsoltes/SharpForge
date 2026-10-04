import {PropertyFault} from '../property/values.js';
import {listElementTypes} from '../contracts/property-lists.js';

const generic = 'System.Collections.Generic.';

/** An enumerator keeps its collection alive, validates its version, and releases that root on Dispose. */
class VectorEnumerator {
  constructor(vector, receiver) {
    this.vector = vector;
    this.receiver = receiver;
    this.version = vector.version;
    this.position = -1;
    this.disposed = false;
  }
  live() {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'The collection enumerator is disposed');
    if (this.vector.version !== this.version) throw new PropertyFault('InvalidOperationException', 'The collection changed during enumeration');
  }
  get Current() {
    this.live();
    if (this.position < 0 || this.position >= this.vector.Count) throw new PropertyFault('InvalidOperationException', 'The enumerator has no current item');
    return this.vector.get_Item(this.position);
  }
  MoveNext() { this.live(); this.position = Math.min(this.position + 1, this.vector.Count); return this.position < this.vector.Count; }
  Reset() { this.live(); this.position = -1; }
  *retainedValues() { if (!this.disposed) yield this.receiver; }
  snapshot() { return {version: 1, vector: this.vector, receiver: this.receiver, revision: this.version, position: this.position, disposed: this.disposed}; }
  restore(snapshot) {
    if (snapshot?.version !== 1 || !Number.isSafeInteger(snapshot.position) || snapshot.position < -1
      || typeof snapshot.disposed !== 'boolean') throw new TypeError('Invalid collection enumerator snapshot');
    this.vector = snapshot.vector;
    this.receiver = snapshot.receiver;
    this.version = snapshot.revision;
    this.position = snapshot.position;
    this.disposed = snapshot.disposed;
  }
  dispose() { this.disposed = true; this.vector = null; this.receiver = null; }
}

function copyTo(context, vector, buffer, index) {
  const capacity = context.items(buffer).length;
  if (!Number.isSafeInteger(index) || index < 0 || index > capacity || vector.Count > capacity - index) {
    throw new PropertyFault('ArgumentException', 'The destination array cannot contain the collection');
  }
  if (capacity > 1000000) throw new RangeError('Collection destination capacity limit');
  for (let offset = 0; offset < vector.Count; offset++) {
    context.getBindingOperations().services.write(buffer, {kind: 'index', key: index + offset}, vector.get_Item(offset));
  }
}

/** Collection interfaces call the same authoritative mutation service as concrete collection classes. */
export function registerListAdapters(registry, vectorFor) {
  const operation = ({context, receiver, descriptor, args}) => {
    const implementation = managedImplementation(context, receiver, descriptor, args);
    if (implementation.handled) return implementation.value;
    const vector = vectorFor(context, receiver);
    if (descriptor.name === 'get_Count') return vector.Count;
    if (descriptor.name === 'get_IsReadOnly') return vector.IsReadOnly ?? typeof vector.set_Item !== 'function';
    if (descriptor.name === 'GetEnumerator') return context.wrapModel(new VectorEnumerator(vector, receiver), descriptor.result);
    if (descriptor.name === 'CopyTo') return copyTo(context, vector, args[0], context.native(args[1]));
    const method = vector[descriptor.name];
    if (typeof method !== 'function') throw new PropertyFault('MissingMethodException', 'The list method is unavailable');
    const values = args.map((value, index) => context.properties.toNative(value, descriptor.parameters[index]));
    context.sceneJournal?.captureModel(vector);
    return context.managed(method.apply(vector, values), descriptor.result);
  };
  for (const element of listElementTypes) {
    const collection = generic + `ICollection\`1<${element}>`;
    const list = generic + `IList\`1<${element}>`;
    for (const name of ['Count', 'IsReadOnly']) registry.register({owner: collection, kind: 'get', name: 'get_' + name}, operation);
    for (const name of ['Add', 'Clear', 'Contains', 'Remove', 'CopyTo']) registry.register({owner: collection, name}, operation);
    for (const name of ['get_Item', 'set_Item', 'IndexOf', 'Insert', 'RemoveAt']) registry.register({owner: list, name}, operation);
    registry.register({owner: generic + `IEnumerable<${element}>`, name: 'GetEnumerator'}, operation);
    registry.register({owner: generic + `IEnumerator\`1<${element}>`, kind: 'get', name: 'get_Current'}, enumeratorOperation);
  }
  registry.register({owner: 'System.Collections.IEnumerable', name: 'GetEnumerator'}, operation);
  registry.register({owner: 'System.Collections.IEnumerator', kind: 'get', name: 'get_Current'}, enumeratorOperation);
  for (const name of ['MoveNext', 'Reset']) registry.register({owner: 'System.Collections.IEnumerator', name}, enumeratorOperation);
  registry.register({owner: 'System.IDisposable', name: 'Dispose'}, call => {
    const value = call.context.unwrapModel(call.receiver);
    if (value !== call.receiver && typeof value?.dispose === 'function') {
      call.context.sceneJournal?.captureModel(value);
      value.dispose();
      return;
    }
    const implementation = managedImplementation(call.context, call.receiver, call.descriptor, []);
    if (implementation.handled) return implementation.value;
    throw new PropertyFault('NotSupportedException', 'The disposable implementation is unavailable');
  });
}

function enumeratorOperation({context, receiver, descriptor}) {
  const model = context.unwrapModel(receiver);
  const implementation = managedImplementation(context, receiver, descriptor, []);
  if (implementation.handled) return implementation.value;
  if (model === receiver || !model || descriptor.name !== 'get_Current' && typeof model[descriptor.name] !== 'function') {
    throw new PropertyFault('NotSupportedException', 'The enumerator implementation is unavailable');
  }
  context.sceneJournal?.captureModel(model);
  const value = descriptor.name === 'get_Current' ? model.Current : model[descriptor.name]();
  return context.managed(value, descriptor.result);
}

function managedImplementation(context, receiver, descriptor, args) {
  const members = context.bindingServices?.members;
  const method = members?.method(receiver, descriptor.name, args.length, {interfaceType: descriptor.owner});
  if (!method) return {handled: false};
  const values = args.map((value, index) => context.properties.toNative(value, descriptor.parameters[index]));
  const value = members.invoke(receiver, method, values);
  return {handled: true, value: context.managed(value, descriptor.result)};
}
