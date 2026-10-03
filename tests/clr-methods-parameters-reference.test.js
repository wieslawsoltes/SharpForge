import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-parameters/native-parameters.json', import.meta.url)));

test('CLR parameter positions, names, flags and raw Constant values match independent CoreCLR reflection/SRM', async () => {
  const module = (await new AssemblyLoadSession().createContext().loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
  const other = (await new AssemblyLoadSession().createContext().loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
  assert.match(native.runtime, /^\.NET 10\./);
  for (const expected of native.methods) {
    const method = module.methodDefinition(expected.token);
    assert.equal(method.name, expected.name);
    assert.equal(method.parameters.length, expected.parameters.length);
    const pairs = [[method.returnParameter, expected.returnParameter],
      ...method.parameters.map((parameter, index) => [parameter, expected.parameters[index]])];
    for (const [parameter, item] of pairs) {
      assert.equal(parameter.position, item.position);
      assert.equal(parameter.metadataToken, item.token);
      assert.equal(parameter.name, item.name);
      assert.equal(parameter.flags, item.flags);
      assert.ok(Object.isFrozen(parameter));
      const constant = parameter.constant;
      // The oracle serializes Int64/UInt64 as decimal text; the codec uses Number when exact, otherwise BigInt.
      const value = constant && [10, 11].includes(constant.type) ? String(constant.value) : constant?.value;
      assert.deepEqual(constant ? { ...constant, value } : null, item.constant);
    }
    assert.notEqual(method.returnParameter, other.methodDefinition(expected.token).returnParameter);
  }
  assert.equal(module.methodBodyReadCount, 0);
});
