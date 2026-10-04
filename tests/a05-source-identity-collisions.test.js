import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, readSourceTypeIdentities} from '@sharpforge/cil';
import {controlFixture} from './support/control-fixture.js';

function metadataWithIdentity(logicalName) {
  const bytes = controlFixture([
    {name: 'Occupied`1', methods: []},
    {name: 'Physical', methods: []},
    {name: 'Program', methods: [{name: 'Main', body: writer => writer.op('ret')}]}
  ]);
  const inspector = new AssemblyInspector(bytes);
  const target = inspector.types.find(type => type.name === 'Physical').token;
  const payload = {format: 'SharpForge.TypeIdentity', version: 1, types: [{token: target,
    sourceIdentity: {name: logicalName, assembly: 'source', arguments: [
      {name: 'System.Int32', assembly: 'core', arguments: []}
    ]}}]};
  const streams = new Map(inspector.metadata.streams);
  streams.set('#SF', new TextEncoder().encode(JSON.stringify(payload)));
  return {...inspector.metadata, streams};
}

test('logical identities reject collisions with unprojected physical CLI definitions', () => {
  assert.throws(() => readSourceTypeIdentities(metadataWithIdentity('Occupied`1')), /collides with a CLI type definition/);
});

test('a separate closed logical name leaves its physical CLI owner unchanged', () => {
  const metadata = metadataWithIdentity('Available`1');
  const identities = readSourceTypeIdentities(metadata);
  assert.equal(identities.size, 1);
  const [[token, identity]] = identities;
  assert.equal(metadata.typeName(token), 'Physical');
  assert.equal(identity.name, 'Available`1');
  assert(Object.isFrozen(identity));
});
