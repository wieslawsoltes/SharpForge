import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { baseContext } from './clr-methods-base-fixtures.js';

const fixture = new URL('./fixtures/clr-method-base-constraints/native-method-bases.json', import.meta.url);
test('CLR constrained generic-method roots match independent native GetBaseDefinition', async () => {
    const native = JSON.parse(readFileSync(fixture));
    const source = readFileSync(new URL('./fixtures/clr-method-base-constraints/Program.cs', import.meta.url));
    const image = Buffer.from(native.image, 'base64');
    assert.equal(native.sourceSHA256, createHash('sha256').update(source).digest('hex'));
    assert.equal(native.imageSHA256, createHash('sha256').update(image).digest('hex'));
    const module = (await baseContext().loadFromStream(image)).manifestModule;
    assert.equal(native.records.length, 12);
    for (const record of native.records) {
      const method = module.methodDefinition(record.token);
      assert.equal(await method.getBaseDefinition(), module.methodDefinition(record.baseToken), record.name);
      assert.equal((await method.getBaseDefinition()).declaringType.fullName, record.baseType);
    }
    assert.equal(module.methodBodyReadCount, 0);
    assert.equal(native.constraintCases.length, 3);
    for (const record of native.constraintCases) {
      const context = baseContext({ typeOptions: { resolveExternalType({ namespace, name }) {
        return context.types.intrinsic(`${namespace}.${name}`);
      } } });
      const bytes = Buffer.from(record.image, 'base64');
      assert.equal(record.imageSHA256, createHash('sha256').update(bytes).digest('hex'));
      const emitted = (await context.loadFromStream(bytes)).manifestModule;
      const method = emitted.methodDefinitions(0x02000003).find(method => method.name === 'M');
      if (record.name === 'stronger-class') {
        assert.equal(record.accepted, false);
        assert.equal(record.error, 'TypeLoadException');
        await assert.rejects(method.getBaseDefinition(), error => error.code === LoadErrorCode.TypeLoad);
      } else {
        assert.equal(record.accepted, true);
        assert.equal((await method.getBaseDefinition()).declaringType.fullName, record.baseType);
      }
    }
});
