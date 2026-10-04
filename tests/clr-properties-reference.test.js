import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeSignature } from '@sharpforge/cil';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-property-definitions/native-properties.json', import.meta.url)));

test('CLR Property identities, signatures, index arity and accessor tokens match CoreCLR reflection/SRM', async () => {
  const module = (await new AssemblyLoadSession().createContext().loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
  assert.match(native.runtime, /^\.NET 10\./);
  const owners = new Map();
  for (const expected of native.properties) {
    const property = module.propertyDefinition(expected.token);
    assert.equal(property.name, expected.name);
    assert.equal(property.declaringType.metadataToken, expected.owner);
    assert.equal(property.flags, expected.flags);
    assert.equal(property.isStatic, expected.isStatic);
    assert.equal(property.getMethod?.metadataToken ?? null, expected.getter);
    assert.equal(property.setMethod?.metadataToken ?? null, expected.setter);
    assert.equal(Boolean(property.getMethod), expected.CanRead);
    assert.equal(Boolean(property.setMethod), expected.CanWrite);
    assert.deepEqual(property.otherMethods.map(method => method.metadataToken), expected.others);
    assert.equal(property.signature.parameters.length, expected.indexParameterCount);
    assert.equal(Buffer.from(encodeSignature(property.signature)).toString('base64'), expected.signature);
    if (!owners.has(expected.owner)) owners.set(expected.owner, []);
    owners.get(expected.owner).push(property);
  }
  for (const [token, properties] of owners) assert.deepEqual(module.propertyDefinitions(token), properties);
  assert.equal(module.methodBodyReadCount, 0);
});
