import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { baseContext } from './clr-methods-base-fixtures.js';

const fixture = new URL('./fixtures/clr-method-base-generic/native-method-bases.json', import.meta.url);
test('CLR generic-instance override roots match independent native GetBaseDefinition',
  { skip: !existsSync(fixture) && 'Native capture pending serial validation' }, async () => {
    const native = JSON.parse(readFileSync(fixture));
    const module = (await baseContext().loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
    for (const record of native.records) {
      const method = module.methodDefinition(record.token);
      assert.equal(await method.getBaseDefinition(), module.methodDefinition(record.baseToken), record.name);
      assert.equal((await method.getBaseDefinition()).declaringType.fullName, record.baseType);
    }
    assert.equal(module.methodBodyReadCount, 0);
  });
