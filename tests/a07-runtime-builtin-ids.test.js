import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {areaReservations, contributionManifest, createRegistry} from '@sharpforge/framework';
import {definitions} from '../packages/bytecode/src/builtins.js';
import {createBuiltinTable} from '../packages/bytecode/src/builtin-table.js';

const locked = JSON.parse(readFileSync(new URL('../planning/contracts/bytecode-ids.lock.json', import.meta.url)));

function extensionRegistry() {
  const area = areaReservations.find(item => item.name === 'A07');
  const boundaries = [
    {name: 'first', start: area.start, size: 1},
    {name: 'last', start: area.start + area.size - 1, size: 1}
  ];
  const registry = createRegistry({reservations: [...contributionManifest, ...boundaries]});
  registry.registerAll([
    ...contributionManifest,
    ...boundaries.map(({name}) => ({
      name,
      register(target) {
        const owner = 'Fixture.BuiltinAbi.' + name;
        target.define(owner);
        target.member(owner, 'Value', ['int'], 'int', {isStatic: true});
      }
    }))
  ]);
  return {registry, boundaries};
}

test('SF-A07-B06 reserved BCL contracts preserve every released builtin ID and signature', () => {
  const {registry, boundaries} = extensionRegistry();
  const table = createBuiltinTable(definitions, registry.contracts, contributionManifest);
  for (const expected of locked.Builtins) {
    const actual = table[expected.id];
    assert(actual, 'Missing released builtin ' + expected.name);
    const {id, name, min, max, result, params} = actual;
    assert.deepEqual({id, name, min, max, result, params}, expected, expected.name);
    assert(Object.isFrozen(actual));
    assert(Object.isFrozen(params));
  }
  for (const boundary of boundaries) {
    const descriptor = registry.contracts.find(item => item.id === boundary.start);
    const entry = table[locked.contractOffset + boundary.start];
    assert.equal(entry.contract, descriptor);
    assert.equal(entry.name, '$framework:' + boundary.start);
    assert.equal(entry.id, locked.contractOffset + boundary.start);
    assert(Object.isFrozen(entry));
  }
  assert.equal(table[1781].name, 'string.Intern');
  assert.equal(table[1792].name, '$type.long.GetType');
  assert.equal(table[1793].name, 'decimal.Truncate#1');
  assert.equal(table[locked.contractOffset + boundaries[0].start - 1], undefined,
    'The gap before the reserved A07 range remains unassigned');
  assert.equal(table.length, locked.contractOffset + boundaries[1].start + 1);
  assert(Object.isFrozen(table));
});
