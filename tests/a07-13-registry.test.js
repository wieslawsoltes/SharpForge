import test from 'node:test';
import assert from 'node:assert/strict';
import {createBclRegistry, bclModules} from '@sharpforge/bcl-core';
import {createRegistry, findContracts} from '@sharpforge/framework';

const example = (name = 'example', family = name) => ({
  name,
  families: [family],
  contracts(registry) {
    registry.define(name, {kind: 'bcl', family});
    registry.member(name, 'Value', [], 'int', {isStatic: true});
  },
  invoke: () => ({handled: true, value: 42})
});

test('BCL contributions extend contracts and dispatch through one family registration', () => {
  const modules = createBclRegistry([example()]);
  const registry = createRegistry({reservations: [{name: 'test', start: 2000000, size: 8}]});
  registry.register({name: 'test', register: target => modules.register(target)});
  const platform = {bclHost: {frameworkType: registry.frameworkType}};
  assert.deepEqual(modules.invoke(platform, registry.contracts[0], []), {handled: true, value: 42});
  assert.deepEqual(modules.invoke(platform, {owner: 'missing'}, []), {handled: false});
  assert.equal(registry.contracts[0].id, 2000000);
  assert(Object.isFrozen(modules.modules[0].families));
});

test('BCL dispatch reuses resolved types and preserves standalone owner lookup', () => {
  const type = {family: 'example'};
  const received = [];
  const modules = createBclRegistry([{
    ...example(),
    invoke(platform, descriptor, args, resolvedType) {
      received.push(resolvedType);
      return {handled: true, value: 42};
    }
  }]);
  let lookups = 0;
  const platform = {bclHost: {frameworkType() { lookups++; return type; }}};
  const descriptor = {owner: 'example'};
  assert.deepEqual(modules.invoke(platform, descriptor, [], type), {handled: true, value: 42});
  assert.equal(lookups, 0);
  assert.deepEqual(modules.invoke(platform, descriptor, [], null), {handled: false});
  assert.equal(lookups, 0);
  assert.deepEqual(modules.invoke(platform, descriptor, []), {handled: true, value: 42});
  assert.equal(lookups, 1);
  assert.deepEqual(received, [type, type]);
});

test('BCL registry rejects duplicate ownership and malformed contributions', () => {
  for (const value of [null, {}, [null], [{name: 'bad'}]]) assert.throws(() => createBclRegistry(value), TypeError);
  assert.throws(() => createBclRegistry([example(), example()]), /Duplicate BCL module/);
  assert.throws(() => createBclRegistry([example('a', 'shared'), example('b', 'shared')]), /Duplicate BCL family/);
  assert.throws(() => createBclRegistry([{...example(), families: ['']}]), /Invalid BCL family/);
  assert.throws(() => createBclRegistry([example()]).register({}, {names: ['missing']}), /Unknown BCL module/);
});

test('BCL registration participates in framework rollback and cancellation', () => {
  const registry = createRegistry({reservations: [{name: 'test', start: 2000000, size: 8}]});
  const modules = createBclRegistry([example(), {...example('bad'), contracts() { throw new Error('broken module'); }}]);
  assert.throws(() => registry.register({name: 'test', register: target => modules.register(target)}), /broken module/);
  assert.equal(registry.contracts.length, 0);
  assert.equal(registry.types.size, 0);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => registry.registerAll([], {signal: controller.signal}), {name: 'AbortError'});
});

test('released BCL groups keep module order and independent registries cannot leak', () => {
  const modules = createBclRegistry(bclModules);
  assert.deepEqual(modules.modules.map(module => module.group), [
    'bcl-prefix', 'bcl-suffix', 'bcl-suffix', 'runtime14', 'runtime14', 'extensions', 'extensions', 'extensions'
  ]);
  const empty = createBclRegistry([]);
  assert.equal(empty.modules.length, 0);
  assert.equal(modules.modules.length, 8);
  const property = findContracts('System.StringComparer', 'get_OrdinalIgnoreCase', true)[0];
  assert.equal(property.id, 524297, 'StringComparer extension appends after the released object comparer contracts');
  const appends = findContracts('System.Text.StringBuilder', 'Append').filter(member => member.parameters[0] === 'char');
  assert.deepEqual(appends.map(member => [member.parameters, member.id]), [[['char'], 524309], [['char', 'int'], 524310]]);
  assert.equal(findContracts('System.Text.StringBuilder', 'get_Chars')[0].id, 524312);
  assert.equal(findContracts('System.Text.StringBuilder', 'set_Chars')[0].id, 524313);
  assert.equal(findContracts('System.Text.StringBuilder', 'CopyTo')[0].id, 524315);
  const int64Appends = findContracts('System.Text.StringBuilder', 'Append')
    .filter(member => ['long', 'ulong'].includes(member.parameters[0]));
  assert.deepEqual(int64Appends.map(member => [member.parameters, member.id]), [[['long'], 524316], [['ulong'], 524317]]);
  assert.equal(findContracts('System.Text.StringBuilder', 'Append')
    .find(member => member.parameters.join(',') === 'string,int,int').id, 524319);
});

test('BCL registry rejects async contracts and malformed invocation results', () => {
  const asyncModule = {...example(), contracts: () => Promise.resolve()};
  assert.throws(() => createBclRegistry([asyncModule]).register({}), /must be synchronous/);
  const platform = {bclHost: {frameworkType: () => ({family: 'example'})}};
  for (const result of [null, {}, Promise.resolve({handled: true})]) {
    const modules = createBclRegistry([{...example(), invoke: () => result}]);
    assert.throws(() => modules.invoke(platform, {}, []), /Invalid BCL invocation result/);
  }
});
