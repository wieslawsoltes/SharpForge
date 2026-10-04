import test from 'node:test';
import assert from 'node:assert/strict';
import {DependencyPropertyRegistry, PropertyStore, BindingOperations, Binding, ObservableObject} from '@sharpforge/winui-properties';

test('A15 ten thousand binding attach/detach cycles return every handler count to baseline', () => {
  const source = new ObservableObject({Name: 'value'});
  const registry = new DependencyPropertyRegistry();
  const property = registry.register({ownerType: 'Element', name: 'Text', propertyType: 'string'});
  const bindings = new BindingOperations();
  for (let index = 0; index < 10000; index++) {
    const store = new PropertyStore({registry, ownerType: 'Element'});
    bindings.SetBinding(store, property, new Binding({Source: source, Path: 'Name'}));
    assert.equal(source.subscriberCount, 1);
    bindings.ClearAllBindings(store);
    store.dispose();
  }
  assert.equal(source.subscriberCount, 0);
});
