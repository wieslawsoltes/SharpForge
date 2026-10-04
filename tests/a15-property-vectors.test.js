import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalType, frameworkAssignable, findContracts} from '@sharpforge/framework';
import {ManagedHeap} from '@sharpforge/runtime';
import {
  UIExtensionRegistry, registerPropertyAdapters, initializeVectorContext, ObservableVector, FrameworkVectorAdapter
} from '@sharpforge/winui-properties';

const prefix = 'Windows.Foundation.Collections.';
const observableType = 'System.Collections.ObjectModel.ObservableCollection`1<int>';
const vectorType = prefix + 'IVector`1<int>';
const observableVectorType = prefix + 'IObservableVector`1<int>';

function host() {
  const states = new Map();
  const operations = [];
  const context = {
    native: value => value, managed: value => value,
    properties: {toNative: value => value},
    unwrapModel: value => value?.model ?? value,
    model: value => value?.model,
    wrapModel: (model, type) => ({model, type}),
    items: value => Array.isArray(value) ? value : value.items ?? [...value.model],
    state(owner, key, factory) {
      let entries = states.get(owner);
      if (!entries) { if (!factory) return undefined; states.set(owner, entries = new Map()); }
      if (!entries.has(key) && factory) entries.set(key, factory());
      return entries.get(key);
    },
    invokeManaged: (callback, args) => callback(...args),
    writeReference: (holder, value) => { holder.value = value; },
    getBindingOperations: () => ({services: {write(buffer, step, value) {
      if (step.key < 0 || step.key >= buffer.length) throw new RangeError('Array store bounds');
      buffer[step.key] = value;
    }}}),
    collectionVersion: value => value.version ?? 0,
    collectionOperation: (receiver, name, args) => { operations.push({receiver, name, args}); }
  };
  initializeVectorContext(context);
  const registry = new UIExtensionRegistry({canonicalType});
  registerPropertyAdapters(registry);
  function invoke(owner, name, receiver, args = []) {
    const descriptor = findContracts(owner, name).find(value => value.parameters.length === args.length);
    assert(descriptor, owner + '::' + name + ' is a registered contract');
    const result = registry.invoke(context, descriptor, receiver, args);
    assert.equal(result.handled, true);
    return result.value;
  }
  return {context, invoke, operations};
}

test('A15 registered generic vector aliases preserve element identity across CLI spellings', () => {
  assert.equal(canonicalType('ObservableCollection<System.Int32>'), observableType);
  assert.equal(canonicalType(prefix + 'IVector<System.Int32>'), vectorType);
  assert.equal(canonicalType(prefix + 'IVector`1<int>'), vectorType);
  assert.equal(canonicalType('Unregistered<System.Int32>'), 'Unregistered<System.Int32>');
  assert.equal(frameworkAssignable(vectorType, observableType), true);
  assert.equal(frameworkAssignable(prefix + 'IVector`1<object>', observableType), false);
  assert.equal(frameworkAssignable('System.ComponentModel.INotifyPropertyChanged', observableType), true);
  assert.equal(frameworkAssignable(prefix + 'IVector`1<Microsoft.UI.Xaml.UIElement>',
    'Microsoft.UI.Xaml.Controls.UIElementCollection'), true);
});

test('A15 method tables project framework interface declarations and generic invariance', () => {
  const heap = new ManagedHeap();
  const vector = heap.methodTables.get(vectorType);
  const source = heap.methodTables.get(observableType);
  assert.equal(vector.flags.interface, true);
  assert.equal(source.flags.interface, false);
  assert(source.interfaceMap.has(vector));
  assert(source.interfaceMap.has(heap.methodTables.get('System.ComponentModel.INotifyPropertyChanged')));
  assert(source.interfaceMap.has(heap.methodTables.get('System.Collections.Generic.IList`1<int>')));
  assert(!source.interfaceMap.has(heap.methodTables.get(prefix + 'IVector`1<object>')));
});

test('A15 ObservableCollection vector projection publishes exact changes and immutable views', () => {
  const {context, invoke, operations} = host();
  const receiver = invoke(observableType, '.ctor', null);
  const changes = [];
  const callback = (sender, args) => { assert.equal(sender, receiver); changes.push(args.model.values); };
  invoke(observableVectorType, 'add_VectorChanged', receiver, [callback]);
  invoke(vectorType, 'Append', receiver, [10]);
  invoke(vectorType, 'Append', receiver, [20]);
  const view = invoke(vectorType, 'GetView', receiver);
  invoke(vectorType, 'SetAt', receiver, [0, 30]);
  assert.equal(invoke(vectorType, 'GetAt', receiver, [0]), 30);
  assert.equal(invoke(prefix + 'IVectorView`1<int>', 'GetAt', view, [0]), 10);
  assert.deepEqual(changes, [{CollectionChange: 1, Index: 0}, {CollectionChange: 1, Index: 1}, {CollectionChange: 3, Index: 0}]);
  const found = {value: -1};
  assert.equal(invoke(vectorType, 'IndexOf', receiver, [20, found]), true);
  assert.equal(found.value, 1);
  const buffer = [0, 0, 99];
  assert.equal(invoke(vectorType, 'GetMany', receiver, [0, buffer]), 2);
  assert.deepEqual(buffer, [30, 20, 99]);
  assert.throws(() => invoke(vectorType, 'GetAt', receiver, [2]), {kind: 'ArgumentOutOfRangeException'});
  assert.throws(() => invoke(vectorType, 'GetMany', receiver, [3, buffer]), {kind: 'ArgumentOutOfRangeException'});
  invoke(observableVectorType, 'remove_VectorChanged', receiver, [callback]);
  invoke(vectorType, 'ReplaceAll', receiver, [[1, 2, 3]]);
  assert.equal(changes.length, 3);
  assert.equal(context.vectorFor(receiver).Count, 3);
  assert.equal(operations.length, 0);
});

test('A15 framework vector writes delegate to authoritative storage and index bindings observe its deltas', () => {
  const {context, operations} = host();
  const receiver = {items: [1, 2], version: 0};
  const vector = context.vectorFor(receiver);
  assert(vector instanceof FrameworkVectorAdapter);
  const changes = [];
  const dispose = vector.subscribePropertyChanged(change => changes.push(change.propertyName));
  vector.set_Item(1, 9);
  assert.deepEqual(receiver.items, [1, 2]);
  assert.deepEqual(operations, [{receiver, name: 'set_Item', args: [1, 9]}]);
  receiver.items[1] = 9;
  receiver.version++;
  context.vectorChanged(receiver, {action: 'Replace', CollectionChange: 3, Index: 1});
  assert.deepEqual(changes, ['Item[]']);
  dispose();
});

test('A15 a single edit in five thousand rows emits one indexed delta without reset', () => {
  const vector = new ObservableVector(Array.from({length: 5000}, (_, index) => index));
  const changes = [];
  vector.subscribe(change => changes.push(change));
  vector.set_Item(2500, -1);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'Replace');
  assert.equal(changes[0].NewStartingIndex, 2500);
  assert.deepEqual(changes[0].NewItems, [-1]);
  assert.deepEqual(changes[0].OldItems, [2500]);
  assert.equal(vector.Count, 5000);
});
