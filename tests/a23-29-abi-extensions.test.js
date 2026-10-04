import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuiltinTable} from '../packages/bytecode/src/builtin-table.js';
import {createBuiltinRegistry} from '../packages/bytecode/src/index.js';

test('A23 T29 extension contracts retain released runtime builtin identities independent of contribution order', () => {
  const definition = ['Released', 0, 0, 'void', []];
  const legacy = {id: 0, owner: 'Legacy', name: 'Call', parameters: [], result: 'void', isStatic: true};
  const extension = {...legacy, id: 524288, owner: 'Extension'};
  for (const contracts of [[legacy, extension], [extension, legacy]]) {
    const entries = createBuiltinTable([definition], contracts, [{start: 0, size: 1}], [['Runtime', 0, 0, 'void', []]]);
    assert.equal(entries[0].name, 'Released');
    assert.equal(entries[1].contract, legacy);
    assert.equal(entries[2].name, 'Runtime');
    assert.equal(entries[524289].contract, extension);
    assert.equal(Object.hasOwn(entries, 3), false);
  }
  assert.throws(() => createBuiltinTable([definition], [legacy, legacy], [{start: 0, size: 1}], []), /overlaps/);
});

test('A23 T29 builtin registry snapshots preserve reserved holes without materializing undefined entries', () => {
  const sparse = [];
  sparse[0] = {id: 0, name: 'First'};
  sparse[12] = {id: 12, name: 'Last'};
  const registry = createBuiltinRegistry(sparse);
  assert.deepEqual(registry.entries, sparse);
  assert.equal(Object.hasOwn(registry.entries, 1), false);
  const [appended] = registry.register({name: 'test', definitions: [['Next', 0, 0, 'void', []]]});
  assert.equal(appended.id, 13);
  assert.equal(registry.entries[12].name, 'Last');
});
