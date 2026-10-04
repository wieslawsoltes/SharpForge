import test from 'node:test';
import assert from 'node:assert/strict';
import {Builtins, CONTRACT_BUILTIN_OFFSET, createBuiltinRegistry} from '@sharpforge/bytecode';
import {areaReservations} from '@sharpforge/framework';

test('A18 builtin registry snapshots preserve reserved holes, exact descriptors and stable append IDs', () => {
  const area = areaReservations.find(block => block.name === 'A18');
  const first = CONTRACT_BUILTIN_OFFSET + area.start;
  const last = first + 8;
  const baseKeys = Object.keys(Builtins);
  const registry = createBuiltinRegistry();
  const before = registry.entries;
  assert.equal(before.length, Builtins.length);
  // Compare the bounded populated-entry count before any value comparison can print a million-slot mismatch.
  assert.equal(Object.keys(before).length, baseKeys.length);
  assert.equal(Object.hasOwn(Builtins, first - 1), false);
  assert.equal(Object.hasOwn(before, first - 1), false);
  assert.equal(Object.hasOwn(before, first), true);
  assert.equal(Object.hasOwn(before, last), true);
  assert.equal(before[first].id, first);
  assert.equal(before[last].id, last);
  for (const key of baseKeys) assert.equal(before[key], Builtins[key], 'Stable builtin descriptor at ' + key);
  assert.equal(Object.isFrozen(before), true);
  const [added] = registry.register({name: 'sparse-regression', definitions: [['Sparse.Append', 0, 0, 'void', []]]});
  const after = registry.entries;
  assert.equal(added.id, Builtins.length);
  assert.equal(after.length, Builtins.length + 1);
  assert.equal(Object.keys(after).length, baseKeys.length + 1);
  assert.equal(Object.hasOwn(after, first - 1), false);
  assert.equal(after[added.id], added);
  assert.equal(registry.get('Sparse.Append'), added);
  assert.equal(Object.hasOwn(before, added.id), false, 'Earlier snapshots remain independent');
  assert.equal(Builtins.length, before.length, 'Appending cannot mutate the frozen base');
});

test('A18 sparse builtin contributions reject atomically without filling holes or reserving names', () => {
  const registry = createBuiltinRegistry();
  const before = registry.entries;
  const count = Object.keys(before).length;
  assert.throws(() => registry.register({name: 'invalid', definitions: [
    ['Sparse.Uncommitted', 0, 0, 'void', []], ['Console.WriteLine', 0, 0, 'void', []]
  ]}), /Duplicate or reserved builtin/);
  assert.equal(registry.get('Sparse.Uncommitted'), null);
  assert.equal(registry.entries.length, before.length);
  assert.equal(Object.keys(registry.entries).length, count);
  const controller = new AbortController();
  controller.abort(new Error('Cancel builtin contribution'));
  assert.throws(() => registry.register({name: 'canceled', definitions: [['Sparse.Canceled', 0, 0, 'void', []]]},
    {signal: controller.signal}), /Cancel builtin contribution/);
  assert.equal(registry.get('Sparse.Canceled'), null);
  const [committed] = registry.register({name: 'committed', definitions: [['Sparse.Uncommitted', 0, 0, 'void', []]]});
  assert.equal(committed.id, before.length);
  assert.equal(Object.keys(registry.entries).length, count + 1);
});

test('A18 builtin snapshots distinguish a reserved hole from an explicitly present undefined slot', () => {
  const base = [];
  base[2] = undefined;
  base[7] = Object.freeze({id: 7, name: 'Sparse.Seven', min: 0, max: 0, result: 'void', params: Object.freeze([])});
  Object.freeze(base);
  const registry = createBuiltinRegistry(base);
  const snapshot = registry.entries;
  assert.deepEqual(Object.keys(snapshot), ['2', '7']);
  assert.equal(Object.hasOwn(snapshot, 1), false);
  assert.equal(Object.hasOwn(snapshot, 2), true);
  assert.equal(snapshot[2], undefined);
  assert.equal(snapshot[7], base[7]);
  assert.equal(registry.get('Sparse.Seven'), base[7]);
  assert.equal(snapshot.length, 8);
  assert.equal(Object.isFrozen(snapshot), true);
});
