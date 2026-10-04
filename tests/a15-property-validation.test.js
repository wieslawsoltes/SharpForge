import test from 'node:test';
import assert from 'node:assert/strict';
import {DependencyPropertyRegistry, PropertyStore, validatePropertyValue} from '@sharpforge/winui-properties';

const cases = [
  ['bool', 'Flag', true, true], ['bool', 'Flag', false, true], ['bool', 'Flag', 1, false],
  ['bool', 'Flag', 0, false], ['bool', 'Flag', null, false], ['bool', 'Flag', 'true', false],
  ['string', 'Text', '', true], ['string', 'Text', null, true], ['string', 'Text', 'hello', true],
  ['string', 'Text', 42, false], ['string', 'Text', false, false], ['string', 'Text', {}, false],
  ['int', 'Count', 0, true], ['int', 'Count', -2147483648, true], ['int', 'Count', 2147483647, true],
  ['int', 'Count', 2147483648, false], ['int', 'Count', -2147483649, false], ['int', 'Count', 1.5, false],
  ['int', 'Count', NaN, false], ['int', 'Count', '1', false], ['int', 'Count', null, false],
  ['uint', 'Count', 4294967295, true], ['uint', 'Count', -1, false], ['uint', 'Count', 4294967296, false],
  ['double', 'Width', 0, true], ['double', 'Width', 100.5, true], ['double', 'Width', NaN, true],
  ['double', 'Width', -1, false], ['double', 'Width', Infinity, false], ['double', 'Width', 'Auto', false],
  ['double', 'MaxWidth', Infinity, true], ['double', 'MaxWidth', -Infinity, false], ['double', 'MaxWidth', -1, false],
  ['double', 'Opacity', 0, true], ['double', 'Opacity', 1, true], ['double', 'Opacity', -0.1, false],
  ['double', 'Opacity', 1.1, false], ['double', 'Opacity', NaN, false], ['double', 'Opacity', Infinity, false],
  ['byte', 'Channel', 0, true], ['byte', 'Channel', 255, true], ['byte', 'Channel', 256, false],
  ['long', 'Ticks', 0n, true], ['long', 'Ticks', -(1n << 63n), true], ['long', 'Ticks', 1n << 63n, false],
  ['double', 'SpeedRatio', 0, false], ['double', 'SpeedRatio', 1, true], ['double', 'SpeedRatio', 1001, false]
];

for (const [type, name, value, valid] of cases) test(`A15 shared validator ${type}.${name}: ${String(value)} (${valid})`, () => {
  const registry = new DependencyPropertyRegistry();
  const property = registry.register({ownerType: 'Element', name, propertyType: type,
    ...(name === 'SpeedRatio' ? {metadata: {defaultValue: 1}} : {})});
  if (valid) assert.equal(validatePropertyValue(property, value), value);
  else assert.throws(() => validatePropertyValue(property, value));
});

test('A15 metadata validation/coercion is shared by local and style writes', () => {
  const registry = new DependencyPropertyRegistry();
  const property = registry.register({ownerType: 'Element', name: 'Count', propertyType: 'int', metadata: {
    validateValueCallback: value => value >= 0,
    coerceValueCallback: (owner, value) => Math.min(value, 10)
  }});
  const store = new PropertyStore({registry, ownerType: 'Element'});
  store.setValue(property, 100);
  assert.equal(store.getValue(property), 10);
  assert.throws(() => store.setValue(property, -1), {kind: 'ArgumentException'});
  assert.equal(store.validateValue(property, 100, {coerce: false}), 100);
  assert.equal(store.getValue(property), 10);
});

test('A15 enum, struct and reference assignability remain strict', () => {
  const registry = new DependencyPropertyRegistry({isAssignable: (target, actual) => target === actual || target === 'Base' && actual === 'Derived'});
  const enumeration = registry.register({ownerType: 'Element', name: 'Mode', propertyType: 'Mode', metadata: {enumValues: {A: 0, B: 1}}});
  const reference = registry.register({ownerType: 'Element', name: 'Other', propertyType: 'Base'});
  const store = new PropertyStore({registry, ownerType: 'Element'});
  store.setValue(enumeration, 1);
  assert.throws(() => store.setValue(enumeration, 2), {kind: 'ArgumentOutOfRangeException'});
  store.setValue(reference, {valueType: 'Derived'});
  assert.throws(() => store.setValue(reference, {valueType: 'Unrelated'}), {kind: 'ArgumentException'});
});
