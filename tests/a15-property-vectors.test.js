import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeVectorContext, ObservableVector, FrameworkVectorAdapter} from '@sharpforge/winui-properties';

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
  return {context, operations};
}

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
