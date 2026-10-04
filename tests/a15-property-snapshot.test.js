import test from 'node:test';
import assert from 'node:assert/strict';
import {DependencyPropertyRegistry, PropertyStore} from '@sharpforge/winui-properties';

test('A15 rewind removes registrations and preserves captured token identity', () => {
  const registry = new DependencyPropertyRegistry();
  const original = registry.register({ownerType: 'Owner', name: 'Value', propertyType: 'int'});
  const before = registry.snapshot();
  const future = registry.register({ownerType: 'Owner', name: 'Future', propertyType: 'int'});
  registry.restore(before);
  assert.equal(registry.resolve(original), original);
  assert.equal(registry.lookup('Owner', 'Future'), null);
  assert.throws(() => registry.resolve(future), {kind: 'ArgumentException'});
  assert.throws(() => new DependencyPropertyRegistry().restore(before), {kind: 'ArgumentException'});
});

test('A15 rewind restores callback removal and removes newly registered callbacks', () => {
  const registry = new DependencyPropertyRegistry();
  const property = registry.register({ownerType: 'Owner', name: 'Value', propertyType: 'int'});
  const store = new PropertyStore({registry, ownerType: 'Owner'});
  const events = [];
  const old = store.registerPropertyChangedCallback(property, () => events.push('old'));
  const before = store.snapshot();
  store.unregisterPropertyChangedCallback(property, old);
  store.registerPropertyChangedCallback(property, () => events.push('new'));
  store.restore(before);
  store.setValue(property, 1);
  assert.deepEqual(events, ['old']);
});
