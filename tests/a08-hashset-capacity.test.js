import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {contracts, findContracts} from '@sharpforge/framework';
import {
  createCapacityHost, capacityState, capacityIterator, observeCapacityIterator, invokeCapacityStep, elementNames
} from './helpers/hashset-capacity.js';

const reference = new URL('../packages/bcl-collections/reference/', import.meta.url);
const captured = JSON.parse(readFileSync(new URL('hash-set-capacity-net10.json', reference), 'utf8'));
const maximumCapacity = 968897;

function compareSteps(host, steps, typed = false) {
  for (const step of steps) {
    const before = capacityState(host, typed);
    const iterator = step.iterator ? capacityIterator(host) : null;
    if (step.capacity > maximumCapacity) {
      assert.equal(step.operation, 'EnsureCapacity', 'Only the explicit over-profile growth row exceeds the limit');
      assert.equal(step.fault, null, 'The native runtime supports this request');
      assert.throws(() => invokeCapacityStep(host, step), error => {
        assert.equal(error.name, 'OutOfMemoryException');
        assert.match(error.message, /^BCLHS0001:/);
        return true;
      });
      assert.deepEqual(capacityState(host, typed), before, 'Profile rejection happens before storage mutation');
      assert.deepEqual(observeCapacityIterator(host, iterator, typed), {moved: false, current: null, fault: null});
      return;
    }
    let result = null;
    let fault = null;
    try { result = invokeCapacityStep(host, step); }
    catch (error) { fault = 'System.' + error.name; }
    assert.deepEqual({result, fault, ...capacityState(host, typed)},
      {result: step.result, fault: step.fault, capacity: step.capacity, count: step.count, values: step.values}, step.operation);
    if (iterator) assert.deepEqual(observeCapacityIterator(host, iterator, typed), step.iterator, step.operation + ' iterator');
  }
}

test('SF-A08-T13: all twenty capacity contracts append after the released A08 ordering contract', () => {
  const ordering = findContracts('System.Collections.Generic.List`1<string>', 'Sort')
    .find(row => row.parameters.length === 1);
  assert.equal(ordering.id, 589824);
  const expected = [];
  for (const element of ['int', 'double', 'bool', 'string', 'object']) {
    const owner = `System.Collections.Generic.HashSet\`1<${element}>`;
    for (const [name, parameters, result] of [
      ['get_Capacity', [], 'int'], ['EnsureCapacity', ['int'], 'int'],
      ['TrimExcess', [], 'void'], ['TrimExcess', ['int'], 'void']
    ]) expected.push({id: 589825 + expected.length, owner, name, parameters, result});
  }
  const actual = contracts.filter(row => row.id >= 589825 && row.id <= 589844)
    .map(({id, owner, name, parameters, result}) => ({id, owner, name, parameters, result}));
  assert.deepEqual(actual, expected);
  for (const row of actual) assert.equal(findContracts(row.owner, row.name).find(member => member.id === row.id).isStatic, false);
});

test('SF-A08-T13: the capacity capture records the pinned runtime, immutable source and four genuine native methods', () => {
  assert.equal(captured.runtime.version, '10.0.5');
  assert.equal(captured.runtime.architecture, 'X64');
  assert.equal(captured.rows.length, 41);
  assert.equal(captured.typedObservations.length, 5);
  const source = readFileSync(new URL('hash-set-capacity/Program.cs', reference));
  assert.equal(createHash('sha256').update(source).digest('hex'), '698e4295d767165b79411e8df36f2a71575f4b35c42e8788388a88b40d0f4fd1');
  const capture = readFileSync(new URL('hash-set-capacity-net10.json', reference));
  assert.equal(createHash('sha256').update(capture).digest('hex'), '2b236eb83e4a07cf8485712550c884ccb1736a36b2f7c1e66235c69ee7ad308b');
  assert.deepEqual(captured.metadata.map(row => [row.name, row.parameterTypes, row.returnType, row.isStatic]), [
    ['get_Capacity', [], 'System.Int32', false], ['EnsureCapacity', ['System.Int32'], 'System.Int32', false],
    ['TrimExcess', [], 'System.Void', false], ['TrimExcess', ['System.Int32'], 'System.Void', false]
  ]);
  assert(captured.metadata.every(row => row.declaringType === 'System.Collections.Generic.HashSet<System.Int32>'));
});

for (const engine of ['source', 'cil']) {
  test(`SF-A08-T13 ${engine}: native capacity, construction, growth, holes, compaction and explicit profile boundary`, () => {
    for (const row of captured.rows) {
      const host = createCapacityHost(engine, {constructor: row.constructor});
      try { compareSteps(host, row.steps); }
      catch (error) { error.message = row.name + ': ' + error.message; throw error; }
      finally { host.stop(); }
    }
  });

  test(`SF-A08-T13 ${engine}: all five closed profiles retain native typed values through growth and compaction`, () => {
    for (const row of captured.typedObservations) {
      const host = createCapacityHost(engine, {element: elementNames[row.elementType], constructor: row.constructor});
      try { compareSteps(host, row.steps, true); }
      finally { host.stop(); }
    }
  });

  test(`SF-A08-T13 ${engine}: null receivers and invalid Int32 requests fail before capacity mutation`, () => {
    const host = createCapacityHost(engine);
    try {
      for (const [name, parameters, values] of [
        ['get_Capacity', [], []], ['EnsureCapacity', ['int'], [-1]],
        ['TrimExcess', [], []], ['TrimExcess', ['int'], [-1]]
      ]) assert.throws(() => host.platform.invoke(host.member(name, parameters), [null, ...values]), {name: 'NullReferenceException'});
      for (const value of [-1, -2147483648, NaN, Infinity, 1.5, 2147483648]) {
        assert.throws(() => host.call('EnsureCapacity', value), {name: 'ArgumentOutOfRangeException'});
        assert.throws(() => host.call('TrimExcess', value), {name: 'ArgumentOutOfRangeException'});
      }
      assert.equal(host.call('TrimExcess', 2147483647), null, 'A large valid trim request is a no-op, not allocation');
      assert.throws(() => host.call('EnsureCapacity', 2147483647), {name: 'OutOfMemoryException'});
      assert.deepEqual(capacityState(host), {capacity: 0, count: 0, values: []});
    } finally { host.stop(); }
  });
}
