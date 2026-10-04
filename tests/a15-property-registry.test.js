import test from 'node:test';
import assert from 'node:assert/strict';
import {DependencyPropertyRegistry, UnsetValue} from '@sharpforge/winui-properties';

function registry() {
  return new DependencyPropertyRegistry({
    baseType: type => type === 'Button' ? 'ContentControl' : null,
    isAssignable: (target, source) => target === source || target === 'ContentControl' && source === 'Button',
    getDeclaredProperty: (owner, name) => owner === 'ContentControl' && name === 'Content' ? {type: 'object'} : null
  });
}

test('A15 property registry preserves declaring identity across inherited lookups', () => {
  const properties = registry();
  const property = properties.lookup('Button', 'Content');
  assert.equal(property, properties.lookup('ContentControl', 'Content'));
  assert.equal(property, properties.lookup('Button', 'Content'));
  assert.equal(property.owner, 'ContentControl');
  assert.equal(properties.applicable(property, 'Button'), true);
  assert.notEqual(UnsetValue, null);
});

test('A15 rejects duplicate and forged registration without consuming identities', () => {
  const properties = registry();
  const options = {ownerType: 'Button', name: 'Count', propertyType: 'int'};
  const property = properties.register(options);
  assert.throws(() => properties.register(options), {kind: 'ArgumentException'});
  assert.throws(() => properties.resolve({...property}), {kind: 'ArgumentException'});
  assert.throws(() => properties.resolve(registry().register(options)), {kind: 'ArgumentException'});
  assert.equal(properties.register({...options, name: 'Next'}).id, property.id + 1);
});

test('A15 attached identities preserve owner independently of target type', () => {
  const properties = registry();
  const row = properties.registerAttached({ownerType: 'Grid', name: 'Row', propertyType: 'int'});
  assert.equal(properties.applicable(row, 'Button'), true);
  assert.equal(properties.lookup('Grid', 'Row'), row);
  assert.equal(properties.lookup('Button', 'Row'), null);
});
