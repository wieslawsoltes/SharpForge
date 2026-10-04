import test from 'node:test';
import assert from 'node:assert/strict';
import {DependencyPropertyRegistry, PropertyStore, ValueSource, UnsetValue, ChangeNotificationQueue} from '@sharpforge/winui-properties';

function setup(metadata = {}) {
  const registry = new DependencyPropertyRegistry();
  const property = registry.register({ownerType: 'Element', name: 'Count', propertyType: 'int', metadata});
  const changes = [];
  const store = new PropertyStore({registry, ownerType: 'Element', onChange: change => changes.push(change)});
  return {registry, property, store, changes};
}

test('A15 every ordered pair of precedence sources restores its underlying source', () => {
  const sources = Object.values(ValueSource);
  for (const first of sources) for (const second of sources) {
    if (first === second) continue;
    const {store, property} = setup();
    store.setSource(property, first, first + 10);
    store.setSource(property, second, second + 10);
    assert.equal(store.getValue(property), Math.max(first, second) + 10);
    store.clearSource(property, Math.max(first, second));
    assert.equal(store.getValue(property), Math.min(first, second) + 10);
    store.clearSource(property, Math.min(first, second));
    assert.equal(store.getValue(property), 0);
  }
});

test('A15 animations reveal live base sources and effective changes emit once', () => {
  const {store, property, changes} = setup();
  store.setSource(property, ValueSource.StyleSetter, 2);
  store.setValue(property, 4);
  store.setSource(property, ValueSource.Animation, 8);
  store.clearValue(property);
  store.setSource(property, ValueSource.StyleSetter, 3);
  assert.equal(store.getValue(property), 8);
  assert.equal(store.getBaseValue(property), 3);
  assert.equal(changes.length, 3);
  store.clearSource(property, ValueSource.Animation);
  store.setSource(property, ValueSource.StyleSetter, 3);
  assert.equal(store.getValue(property), 3);
  assert.equal(changes.length, 4);
});

test('A15 metadata factories and callback tokens are per owner and snapshot safe', () => {
  let factories = 0;
  const events = [];
  const {registry, store, property} = setup({
    createDefaultValueCallback: () => ++factories,
    propertyChangedCallback: (owner, change) => events.push([change.oldValue, change.newValue])
  });
  assert.equal(store.getValue(property), 1);
  assert.equal(store.getValue(property), 1);
  const second = new PropertyStore({registry, ownerType: 'Element'});
  assert.equal(second.getValue(property), 2);
  let callbacks = 0;
  const token = store.registerPropertyChangedCallback(property, () => callbacks++);
  const snapshot = store.snapshot();
  store.unregisterPropertyChangedCallback(property, token);
  store.setValue(property, 3);
  assert.equal(callbacks, 0);
  store.restore(snapshot);
  store.setValue(property, 4);
  store.setValue(property, 4);
  assert.equal(callbacks, 1);
  assert.deepEqual(events, [[1, 3], [1, 4]]);
});

test('A15 transaction validation failures leave all effective values and callbacks unchanged', () => {
  const {store, property, changes} = setup();
  store.setValue(property, 1);
  assert.throws(() => store.transaction(() => {
    store.setValue(property, 2);
    store.setValue(property, 'bad');
  }), {kind: 'ArgumentException'});
  assert.equal(store.getValue(property), 1);
  assert.equal(changes.length, 1);
  store.transaction(() => {
    store.setValue(property, 2);
    store.setValue(property, 3);
  });
  assert.deepEqual(changes.at(-1).oldValue, 1);
  assert.deepEqual(changes.at(-1).newValue, 3);
});

test('A15 inherited values update on logical reparent and respect local values', () => {
  const {registry, property} = setup({inherits: true});
  const left = new PropertyStore({registry, ownerType: 'Element'});
  const right = new PropertyStore({registry, ownerType: 'Element'});
  const child = new PropertyStore({registry, ownerType: 'Element'});
  left.setValue(property, 10);
  right.setValue(property, 20);
  child.setParent(left);
  assert.equal(child.getValue(property), 10);
  child.setParent(right);
  assert.equal(child.getValue(property), 20);
  child.setValue(property, 30);
  right.setValue(property, 40);
  assert.equal(child.getValue(property), 30);
  child.clearValue(property);
  assert.equal(child.getValue(property), 40);
  assert.throws(() => right.setParent(child), {kind: 'InvalidOperationException'});
  child.setParent(null);
  assert.equal(child.getValue(property), 0);
});

test('A15 null local values and unregister do not collapse into defaults', () => {
  const registry = new DependencyPropertyRegistry();
  const property = registry.register({ownerType: 'Element', name: 'Text', propertyType: 'string'});
  const store = new PropertyStore({registry, ownerType: 'Element'});
  assert.equal(store.readLocalValue(property), UnsetValue);
  store.setValue(property, null);
  assert.equal(store.readLocalValue(property), null);
  store.clearValue(property);
  assert.equal(store.readLocalValue(property), UnsetValue);
  store.dispose();
  store.dispose();
  assert.throws(() => store.getValue(property), {kind: 'ObjectDisposedException'});
});

test('A15 notifications converge FIFO or fault at a deterministic budget', () => {
  const queue = new ChangeNotificationQueue({maxChanges: 8});
  const order = [];
  const one = {};
  const two = {};
  queue.batch(() => {
    queue.enqueue(one, change => order.push(change.newValue), {oldValue: 0, newValue: 1});
    queue.enqueue(two, change => order.push(change.newValue), {oldValue: 0, newValue: 2});
    queue.enqueue(one, change => order.push(change.newValue), {oldValue: 1, newValue: 3});
  });
  assert.deepEqual(order, [3, 2]);
  const repeat = () => queue.enqueue(one, repeat, {oldValue: 0, newValue: 1});
  assert.throws(repeat, {kind: 'InvalidOperationException'});
  assert.equal(queue.pending.size, 0);
});
