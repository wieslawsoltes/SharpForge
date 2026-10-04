import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistry} from '../packages/framework/src/registry.js';

function signature(type) {
  const registry = createRegistry({reservations: [{name: 'nullable', start: 100, size: 10}]});
  registry.register({name: 'nullable', register(api) {
    api.define('Receiver');
    api.define('Date', {kind: 'value', base: 'System.ValueType'});
    api.define('Mode', {kind: 'enum', base: 'System.Enum', values: {First: 0}});
    api.member('Receiver', 'Read', [], type);
  }});
  return registry;
}

test('A15 closed nullable contract signatures accept primitive, enum, and declared value payloads', () => {
  for (const type of ['int?', 'Date?', 'System.Nullable`1<Date>', 'System.Nullable<Mode>', 'System.Nullable`1<double>[]']) {
    assert.equal(signature(type).contracts[0].result, type);
  }
});

test('A15 nullable signatures reject references, nested nullable types, and undeclared payloads', () => {
  for (const type of ['object?', 'Receiver?', 'Missing?', 'System.Nullable`1<Receiver>', 'System.Nullable`1<Missing>',
    'System.Nullable`1<int?>', 'System.Nullable`1<int,double>', 'System.Nullable`1<void>', 'int??']) {
    assert.throws(() => signature(type), /Unknown type/);
  }
});
