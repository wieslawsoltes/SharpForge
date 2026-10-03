import test from 'node:test';
import assert from 'node:assert/strict';
import { Tables, TableId, tableDefinitions, metadataSchemas } from '@sharpforge/cil';

test('A03 table registry covers every type-system and Portable PDB table', () => {
  assert.equal(Tables, TableId);
  assert.equal(Object.keys(Tables).length, 53);
  for (const id of [...Array.from({ length: 45 }, (_, n) => n), ...Array.from({ length: 8 }, (_, n) => n + 48)]) {
    const definition = tableDefinitions[id];
    assert.equal(Tables[definition.name], id);
    assert.equal(definition.columns.length, metadataSchemas[id].length);
    assert.equal(new Set(definition.columns).size, definition.columns.length);
    assert(Object.isFrozen(definition));
  }
  for (const id of [45, 46, 47, 56, -1]) assert.equal(tableDefinitions[id], undefined);
  assert.throws(() => { Tables.TypeDef = 99; }, TypeError);
});
