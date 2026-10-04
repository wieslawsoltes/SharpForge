import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { baseContext } from './clr-methods-base-fixtures.js';

const fixture = new URL('./fixtures/clr-method-base-generic/native-method-bases.json', import.meta.url);
test('CLR generic-instance override roots match independent native GetBaseDefinition', async () => {
    const native = JSON.parse(readFileSync(fixture));
    const source = readFileSync(new URL('./fixtures/clr-method-base-generic/Program.cs', import.meta.url));
    const image = Buffer.from(native.image, 'base64');
    assert.equal(native.sourceSHA256, createHash('sha256').update(source).digest('hex'));
    assert.equal(native.imageSHA256, createHash('sha256').update(image).digest('hex'));
    const module = (await baseContext().loadFromStream(image)).manifestModule;
    for (const record of native.records) {
      const method = module.methodDefinition(record.token);
      assert.equal(await method.getBaseDefinition(), module.methodDefinition(record.baseToken), record.name);
      assert.equal((await method.getBaseDefinition()).declaringType.fullName, record.baseType);
    }
    assert.equal(module.methodBodyReadCount, 0);
});
