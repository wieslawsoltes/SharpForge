import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-property-parameters/native-property-parameters.json', import.meta.url)));

test('CLR property index-parameter ownership, types, names, attributes and defaults match CoreCLR reflection/SRM', async () => {
  const module = (await new AssemblyLoadSession().createContext().loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
  assert.match(native.runtime, /^\.NET 10\./);
  for (const expected of native.properties) {
    const property = module.propertyDefinition(expected.token);
    assert.equal(property.indexParameters.length, expected.parameters.length);
    for (const [index, item] of expected.parameters.entries()) {
      const parameter = property.indexParameters[index];
      assert.equal(parameter.name, item.name);
      assert.equal(parameter.metadataToken, item.token);
      assert.equal(parameter.position, item.position);
      assert.equal(parameter.flags, item.flags);
      assert.equal(parameter.member, property);
      assert.equal(parameter.member.metadataToken, item.member);
      assert.equal(parameter.method.metadataToken, expected.accessor);
      assert.deepEqual(parameter.signatureType, item.signatureType);
      assert.deepEqual(parameter.constant, item.constant);
    }
  }
  assert.equal(module.methodBodyReadCount, 0);
});
