import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeSignature } from '@sharpforge/cil';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-field-definitions/native-fields.json', import.meta.url)));

test('CLR FieldDef identities, attributes, signatures and constants match independent CoreCLR reflection/SRM', async () => {
  const module = (await new AssemblyLoadSession().createContext().loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
  assert.match(native.runtime, /^\.NET 10\./);
  const owners = new Map();
  for (const expected of native.fields) {
    const field = module.fieldDefinition(expected.token);
    assert.equal(field.name, expected.name);
    assert.equal(field.declaringType.metadataToken, expected.owner);
    assert.equal(field.flags, expected.flags);
    assert.equal(field.isStatic, expected.IsStatic);
    assert.equal(field.isInitOnly, expected.IsInitOnly);
    assert.equal(field.isLiteral, expected.IsLiteral);
    assert.equal(Buffer.from(encodeSignature(field.signature)).toString('base64'), expected.signature);
    const constant = field.constant;
    const value = constant && [10, 11].includes(constant.type) ? String(constant.value) : constant?.value;
    assert.deepEqual(constant ? { ...constant, value } : null, expected.constant);
    if (!owners.has(expected.owner)) owners.set(expected.owner, []);
    owners.get(expected.owner).push(field);
  }
  for (const [token, fields] of owners) assert.deepEqual(module.fieldDefinitions(token), fields);
  assert.equal(module.methodBodyReadCount, 0);
});
