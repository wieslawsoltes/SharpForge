import test from 'node:test';
import assert from 'node:assert/strict';
import {Builtins, createBuiltinRegistry} from '@sharpforge/bytecode';

const builtin = (id, name) => Object.freeze({id, name, min: 0, max: 0, result: 'void', params: Object.freeze([])});
const definition = name => [name, 0, 0, 'void', []];

test('builtin registry preserves reserved holes, explicit undefined slots and immutable snapshots', () => {
  const base = [];
  base[0] = builtin(0, 'First');
  base[3] = undefined;
  base[655360] = builtin(655360, 'Reserved');
  Object.freeze(base);
  const registry = createBuiltinRegistry(base);
  const before = registry.entries;
  assert.equal(before.length, base.length);
  // Counts and single positions give compact failures even if every hole was materialized.
  assert.equal(Object.keys(before).length, 3);
  assert.equal(Object.hasOwn(before, 1), false);
  assert.equal(Object.hasOwn(before, 3), true);
  assert.strictEqual(before[0], base[0]);
  assert.strictEqual(before[655360], base[655360]);
  assert.equal(Object.isFrozen(before), true);

  const [added] = registry.register({name: 'extension', definitions: [definition('Appended')]});
  const after = registry.entries;
  assert.equal(added.id, 655361);
  assert.strictEqual(registry.get('Appended'), added);
  assert.strictEqual(after[added.id], added);
  assert.equal(Object.keys(after).length, 4);
  assert.equal(Object.hasOwn(after, 655359), false);
  assert.equal(before.length, 655361);
  assert.equal(base.length, 655361);
  assert.equal(Object.hasOwn(before, added.id), false);
});

test('builtin registry rejected and cancelled contributions leave sparse entries unchanged', () => {
  const base = [];
  base[100] = builtin(100, 'Existing');
  const registry = createBuiltinRegistry(base);
  assert.throws(() => registry.register({
    name: 'duplicate', definitions: [definition('Staged'), definition('Existing')]
  }), /Duplicate/);
  assert.equal(registry.get('Staged'), null);

  const controller = new AbortController();
  const definitions = [definition('FirstStage')];
  Object.defineProperty(definitions, 1, {
    get() { controller.abort(); return definition('SecondStage'); }
  });
  assert.throws(() => registry.register({name: 'cancelled', definitions}, {signal: controller.signal}), {name: 'AbortError'});
  const entries = registry.entries;
  assert.equal(entries.length, 101);
  assert.equal(Object.keys(entries).length, 1);
  assert.strictEqual(entries[100], base[100]);
  assert.equal(registry.get('FirstStage'), null);
  assert.equal(registry.get('SecondStage'), null);
});

test('builtin registry retains iterable bases and every released or extension identifier', () => {
  const entry = builtin(0, 'Iterable');
  const iterable = createBuiltinRegistry(new Set([entry]));
  assert.strictEqual(iterable.entries[0], entry);
  assert.equal(iterable.register({name: 'next', definitions: [definition('Next') ]})[0].id, 1);

  const registry = createBuiltinRegistry();
  const entries = registry.entries;
  const keys = Object.keys(Builtins);
  assert.equal(entries.length, Builtins.length);
  assert.equal(Object.keys(entries).length, keys.length);
  for (const key of keys) assert.strictEqual(entries[key], Builtins[key], `Builtin ID ${key}`);
});
