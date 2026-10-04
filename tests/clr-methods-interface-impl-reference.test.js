import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { interfaceContext } from './clr-methods-interface-impl-fixtures.js';

const fixture = new URL('./fixtures/clr-method-interface-impl/native-method-bases.json', import.meta.url);

test('CLR class roots through explicit interfaces match independent CoreCLR GetBaseDefinition',
  { skip: !existsSync(fixture) && 'Native capture pending the serial validation slot' }, async () => {
    const native = JSON.parse(readFileSync(fixture));
    const context = interfaceContext();
    const module = (await context.loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
    assert.match(native.runtime, /^\.NET 10\./);
    assert.ok(module.rowCount(25) >= 2);
    assert.ok(native.records.some(record => record.token !== record.baseToken));
    for (const record of native.records) {
      const method = module.methodDefinition(record.token);
      const base = await method.getBaseDefinition();
      assert.equal(base, module.methodDefinition(record.baseToken), `${record.declaringType}.${record.name}`);
      assert.equal(base.declaringType.fullName, record.baseType);
      assert.equal(await method.getBaseDefinition(), base);
    }
    assert.equal(module.methodBodyReadCount, 0);
  });
