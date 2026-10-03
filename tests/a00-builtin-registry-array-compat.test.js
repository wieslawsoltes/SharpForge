import test from 'node:test';
import assert from 'node:assert/strict';
import {Builtins, createBuiltinRegistry} from '@sharpforge/bytecode';

const builtin = (id, name) => Object.freeze({id, name, min: 0, max: 0, result: 'void', params: Object.freeze([])});
const definition = name => [name, 0, 0, 'void', []];

test('default builtin snapshots retain array shape, holes, identity and append isolation', () => {
  const registry = createBuiltinRegistry();
  const before = registry.entries;
  const keys = Object.keys(Builtins);
  assert.equal(Array.isArray(before), true);
  assert.equal(Object.getPrototypeOf(before), Array.prototype);
  assert.equal(Object.isFrozen(before), true);
  assert.equal(before.length, Builtins.length);
  assert.equal(Object.keys(before).length, keys.length);
  for (const key of keys) assert.strictEqual(before[key], Builtins[key], `Builtin slot ${key}`);

  const [entry] = registry.register({name: 'append', definitions: [definition('Added')]});
  const after = registry.entries;
  assert.equal(entry.id, before.length);
  assert.strictEqual(after[entry.id], entry);
  assert.strictEqual(registry.get('Added'), entry);
  assert.equal(after.length, before.length + 1);
  assert.equal(Object.keys(after).length, keys.length + 1);
  assert.equal(Object.hasOwn(before, entry.id), false);
  assert.equal(Object.isFrozen(after), true);
});

test('default builtin snapshots remain unchanged after rejection and late cancellation', () => {
  const registry = createBuiltinRegistry();
  const before = registry.entries;
  assert.throws(() => registry.register({name: 'duplicate', definitions: [definition('Staged'), definition(Builtins[0].name)]}), /Duplicate/);
  const controller = new AbortController();
  const definitions = [definition('FirstStage')];
  Object.defineProperty(definitions, 1, {get() {controller.abort(); return definition('SecondStage');}});
  assert.throws(() => registry.register({name: 'cancelled', definitions}, {signal: controller.signal}), {name: 'AbortError'});
  const after = registry.entries;
  assert.equal(after.length, before.length);
  assert.equal(Object.keys(after).length, Object.keys(before).length);
  for (const key of Object.keys(before)) assert.strictEqual(after[key], before[key]);
  for (const name of ['Staged', 'FirstStage', 'SecondStage']) assert.equal(registry.get(name), null);
  assert.equal(registry.register({name: 'retry', definitions: [definition('Retry')]})[0].id, before.length);
});

test('custom array bases preserve nonenumerable slots, explicit undefined and trailing holes', () => {
  const base = [];
  Object.defineProperty(base, 2, {value: builtin(2, 'Hidden')});
  Object.defineProperty(base, 4, {value: undefined});
  base.length = 9;
  base.extra = 'not an index';
  base[Symbol('extra')] = 'not an index';
  const registry = createBuiltinRegistry(Object.freeze(base));
  const entries = registry.entries;
  assert.equal(entries.length, 9);
  assert.deepEqual(Object.keys(entries), ['2', '4']);
  assert.strictEqual(entries[2], base[2]);
  assert.equal(Object.hasOwn(entries, 4), true);
  assert.equal(Object.hasOwn(entries, 8), false);
  assert.equal(Object.getOwnPropertyDescriptor(entries, 2).enumerable, true);
  assert.equal(Object.getOwnPropertySymbols(entries).length, 0);
  assert.equal(registry.register({name: 'append', definitions: [definition('Next')]})[0].id, 9);
});

test('custom array accessors and inherited numeric slots retain slice behavior', () => {
  const inherited = builtin(3, 'Inherited');
  const prototype = Object.create(Array.prototype, {3: {value: inherited}});
  const base = Object.setPrototypeOf([], prototype);
  const first = builtin(0, 'First');
  const addedByGetter = builtin(2, 'GetterAdded');
  let reads = 0;
  Object.defineProperty(base, 0, {get() {reads++; base[2] = addedByGetter; return first;}});
  base.length = 5;
  const registry = createBuiltinRegistry(base);
  const entries = registry.entries;
  assert.equal(reads, 1);
  assert.deepEqual(Object.keys(entries), ['0', '2', '3']);
  assert.strictEqual(entries[0], first);
  assert.strictEqual(entries[2], addedByGetter);
  assert.strictEqual(entries[3], inherited);
  assert.strictEqual(registry.get('Inherited'), inherited);
});

test('custom array species and slice overrides retain their existing result shape', () => {
  class Snapshot extends Array {}
  class Base extends Array {static get [Symbol.species]() {return Snapshot;}}
  const base = new Base(6);
  base[4] = builtin(4, 'Subclass');
  const entries = createBuiltinRegistry(base).entries;
  assert.equal(entries instanceof Snapshot, true);
  assert.equal(entries.length, 6);
  assert.deepEqual(Object.keys(entries), ['4']);
  assert.equal(Object.isFrozen(entries), true);

  const overridden = [builtin(0, 'Override')];
  let calls = 0;
  Object.defineProperty(overridden, 'slice', {value() {calls++; return [this[0]];}});
  assert.strictEqual(createBuiltinRegistry(overridden).entries[0], overridden[0]);
  assert.equal(calls, 1);
});

test('custom array proxies can supply virtual numeric slots through HasProperty', () => {
  const virtual = builtin(3, 'Virtual');
  const base = new Proxy(new Array(5), {
    has(target, key) {return key === '3' || Reflect.has(target, key);},
    get(target, key, receiver) {return key === '3' ? virtual : Reflect.get(target, key, receiver);}
  });
  const registry = createBuiltinRegistry(base);
  const entries = registry.entries;
  assert.equal(entries.length, 5);
  assert.deepEqual(Object.keys(entries), ['3']);
  assert.strictEqual(entries[3], virtual);
  assert.strictEqual(registry.get('Virtual'), virtual);
});
