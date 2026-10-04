import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { baseContext } from './clr-methods-base-fixtures.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-method-base-definition/native-method-bases.json', import.meta.url)));

test('CLR implicit class override roots match independent CoreCLR GetBaseDefinition results', async () => {
  const context = baseContext();
  const module = (await context.loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
  assert.match(native.runtime, /^\.NET 10\./);
  for (const record of native.records) {
    const method = module.methodDefinition(record.token);
    const base = await method.getBaseDefinition();
    assert.equal(base, module.methodDefinition(record.baseToken), `${record.declaringType}.${record.name}`);
    assert.equal(base.declaringType.fullName, record.baseType);
    assert.equal(await method.getBaseDefinition(), base);
  }
  assert.equal(module.methodBodyReadCount, 0);
});
