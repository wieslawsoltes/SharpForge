import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-method-attributes/native-method-attributes.json', import.meta.url)));

test('CLR method attributes and calling conventions match independent CoreCLR reflection', async () => {
  const module = (await new AssemblyLoadSession().createContext().loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
  assert.match(native.runtime, /^\.NET 10\./);
  for (const record of native.records) {
    const method = module.methodDefinition(record.token);
    for (const [name, expected] of Object.entries(record)) {
      if (name === 'token') continue;
      assert.equal(method[name === 'attributes' ? 'flags' : name], expected, `${record.name}.${name}`);
    }
  }
  assert.equal(module.methodBodyReadCount, 0);
});
