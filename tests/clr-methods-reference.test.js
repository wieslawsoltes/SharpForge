import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatSignature } from '@sharpforge/cil';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-method-definitions/native-methods.json', import.meta.url)));

test('CLR declared MethodDef identities, signatures and body bytes match independent CoreCLR reflection', async () => {
  const module = (await new AssemblyLoadSession().createContext().loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
  assert.match(native.runtime, /^\.NET 10\./);
  for (const expected of native.definitions) {
    const methods = module.methodDefinitions(expected.token);
    assert.deepEqual(methods.map(method => method.metadataToken), expected.methods.map(method => method.token));
    assert.equal(module.typeDefinition(expected.token).fullName, expected.name);
    for (const item of expected.methods) {
      const method = module.methodDefinition(item.token);
      assert.ok(methods.includes(method));
      assert.equal(method.name, item.name);
      assert.equal(method.declaringType.metadataToken, item.declaringType);
      assert.equal(method.flags, item.attributes);
      assert.equal(method.implementationFlags, item.implementationFlags);
      assert.equal(method.isStatic, item.isStatic);
      const signature = { kind: 'method', isStatic: item.isStatic, returnType: item.returnType, parameters: item.parameters };
      if (item.genericArity) signature.genericArity = item.genericArity;
      assert.deepEqual(formatSignature(method.signature), signature);
    }
  }
  assert.equal(module.methodBodyReadCount, 0);
  for (const owner of native.definitions) {
    for (const item of owner.methods) {
      const body = module.methodDefinition(item.token).getMethodBody();
      assert.equal(body ? Buffer.from(body.code).toString('base64') : null, item.body);
    }
  }
});
