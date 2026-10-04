import test from 'node:test';
import assert from 'node:assert/strict';
import {bclModules, createBclRegistry} from '@sharpforge/bcl-core';
import {createRegistry, contributionManifest, idReservations, frameworkType, findContracts} from '@sharpforge/framework';

const owner = 'System.Boolean';
const module = bclModules.find(entry => entry.name === 'boolean');

test('Boolean fields: a field-only module registers a value type without method IDs or property accessors', () => {
  assert(module);
  assert.equal(bclModules.at(-1), module);
  const registry = createRegistry();
  createBclRegistry([module]).register(registry);
  const type = registry.frameworkType(owner);
  assert.equal(type.kind, 'value');
  assert.equal(type.base, 'System.ValueType');
  assert.equal(type.isSealed, true);
  assert.deepEqual(Object.keys(type.fields).sort(), ['FalseString', 'TrueString']);
  assert.deepEqual(type.properties, {});
  assert.deepEqual(type.events, {});
  assert.deepEqual(registry.contracts, []);
  assert.equal(registry.memberIndex.size, 0);
  assert.deepEqual(module.invoke(), {handled: false});
  assert.equal(registry.validate(), true);
});

test('Boolean fields: genuine readonly descriptors preserve exact text and both approved assembly scopes', () => {
  const type = frameworkType(owner);
  for (const [name, value] of [['TrueString', 'True'], ['FalseString', 'False']]) {
    const field = type.fields[name];
    assert.deepEqual(field, {
      type: 'string', isStatic: true, readOnly: true, value, addressable: false,
      assemblies: ['System.Runtime', 'System.Private.CoreLib']
    });
    assert.equal(Object.isFrozen(field), true);
    assert.equal(Object.isFrozen(field.assemblies), true);
    assert.equal(Object.hasOwn(field, 'constantValue'), false);
    assert.equal(type.properties[name], undefined);
    assert.deepEqual(findContracts(owner, 'get_' + name), []);
    assert.deepEqual(findContracts(owner, 'set_' + name), []);
    assert.throws(() => { field.value = 'changed'; }, TypeError);
  }
  assert.equal(Object.isFrozen(type.fields), true);
});

test('Readonly string fields: plain UTF-16 values retain exact code units and conservative defaults', () => {
  const values = ['', '\0', '\ud800', '\udfff', '\ud83d\ude00', 'a\0b'];
  for (const value of values) {
    const input = {type: 'string', isStatic: true, readOnly: true, value};
    const registry = createRegistry();
    registry.define('Fixture.StringField', {fields: {Value: input}});
    input.value = 'changed after registration';
    const field = registry.frameworkType('Fixture.StringField').fields.Value;
    assert.equal(field.value, value);
    assert.equal(field.value.length, value.length);
    assert.equal(field.addressable, false);
    assert.deepEqual(field.assemblies, ['System.Runtime']);
    assert.equal(Object.isFrozen(field), true);
    assert.equal(Object.isFrozen(field.assemblies), true);
    assert.equal(JSON.parse(JSON.stringify(field)).value, value);
    assert.equal(registry.validate(), true);
  }
});

function registerWithModules(modules) {
  const registry = createRegistry({reservations: idReservations});
  const bcl = createBclRegistry(modules);
  registry.registerAll([...contributionManifest, {
    name: 'A07',
    register: target => bcl.register(target, {group: 'extensions'})
  }]);
  return registry;
}

test('Boolean fields: appending the module preserves every existing contract and primitive signature spelling', () => {
  const before = registerWithModules(bclModules.filter(entry => entry.name !== 'boolean'));
  const after = registerWithModules(bclModules);
  assert.deepEqual(after.contracts, before.contracts);
  assert.equal(after.types.size, before.types.size + 1);
  assert.equal(before.frameworkType(owner), null);
  assert.equal(after.frameworkType('Boolean'), after.frameworkType(owner));
  assert.equal(after.canonicalType('bool'), 'bool');
  assert.deepEqual([...after.origins], [...before.origins]);
});
