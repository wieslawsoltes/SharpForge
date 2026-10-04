import test from 'node:test';
import assert from 'node:assert/strict';
import {frameworkType} from '@sharpforge/framework';
import {DependencyPropertyRegistry, PropertyStore, PropertyMetadata} from '@sharpforge/winui-properties';

test('A15 declared flags accept combinations and reject unknown bits without changing the prior value', () => {
  const type = 'Windows.ApplicationModel.DataTransfer.DataPackageOperation';
  const registry = new DependencyPropertyRegistry({typeDefinition: frameworkType});
  const property = registry.register({ownerType: 'Owner', name: 'AllowedOperations', propertyType: type,
    metadata: new PropertyMetadata(7)});
  const store = new PropertyStore({registry, ownerType: 'Owner'});
  assert.equal(store.getValue(property), 7);
  for (const value of [0, 1, 2, 3, 4, 5, 6, 7]) store.setValue(property, value);
  for (const value of [-1, 8, 0xffffffff, 0x100000000, 1.5, NaN, '3', null]) {
    assert.throws(() => store.setValue(property, value), {kind: 'ArgumentOutOfRangeException'});
    assert.equal(store.getValue(property), 7);
  }
});

test('A15 ordinary enumerations retain exact membership while explicit flags metadata permits combinations', () => {
  const registry = new DependencyPropertyRegistry();
  const values = {First: 1, Second: 2};
  const ordinary = registry.register({ownerType: 'Owner', name: 'Ordinary', propertyType: 'Mode',
    metadata: new PropertyMetadata(1, null, {enumValues: values})});
  const flags = registry.register({ownerType: 'Owner', name: 'Flags', propertyType: 'Mode',
    metadata: new PropertyMetadata(1, null, {enumValues: values, flags: true})});
  const store = new PropertyStore({registry, ownerType: 'Owner'});
  assert.throws(() => store.setValue(ordinary, 3), {kind: 'ArgumentOutOfRangeException'});
  store.setValue(flags, 3);
  assert.equal(store.getValue(flags), 3);
});
