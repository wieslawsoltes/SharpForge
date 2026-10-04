import test from 'node:test';
import assert from 'node:assert/strict';
import { Builtins, BuiltinMap, createBuiltinRegistry } from '@sharpforge/bytecode';
import { contracts, areaReservations } from '@sharpforge/framework';

test('released runtime builtin identity and sparse registry copies remain stable', () => {
  assert.equal(BuiltinMap.get('string.Intern').id, 1781);
  const registry = createBuiltinRegistry();
  assert.deepEqual(registry.entries, Builtins);
  const [extension] = registry.register({ name: 'A19-test', definitions: [['Extension', 0, 0, 'void', []]] });
  assert.equal(extension.id, Builtins.length);
  assert.equal(registry.get('string.Intern'), BuiltinMap.get('string.Intern'));
  assert.equal(registry.entries[extension.id], extension);
});

test('copying sparse extension registries preserves holes instead of allocating placeholder entries', () => {
  const base = [];
  base[65_536] = Object.freeze({ id: 65_536, name: 'Sparse', min: 0, max: 0, result: 'void', params: [] });
  const registry = createBuiltinRegistry(Object.freeze(base));
  const copy = registry.entries;
  assert.deepEqual(copy, base);
  assert.equal(0 in copy, false);
  assert.equal(65_535 in copy, false);
  assert.equal(registry.get('Sparse'), base[65_536]);
});

test('environment registration uses the existing A07 reserved block without changing released slots', () => {
  const area = areaReservations.find(value => value.name === 'A07');
  const environment = contracts.filter(value => value.owner === 'System.Environment');
  assert.equal(environment.length, 1);
  assert.equal(environment[0].id, area.start);
  assert.equal(environment[0].name, 'GetEnvironmentVariable');
  assert.equal(Builtins[1781].name, 'string.Intern');
  assert.equal(Builtins[1792].name, '$type.long.GetType');
});
