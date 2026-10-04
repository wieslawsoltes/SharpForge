import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { baseContext } from './clr-methods-base-fixtures.js';

test('CLR nested strict roots and rejected inheritance paths match independent native loading', async () => {
  const directory = new URL('./fixtures/clr-method-base-nested-strict/', import.meta.url);
  const native = JSON.parse(readFileSync(new URL('native-method-bases.json', directory)));
  const hash = value => createHash('sha256').update(value).digest('hex');
  const image = Buffer.from(native.image, 'base64');
  assert.equal(native.sourceSHA256, hash(readFileSync(new URL('Program.cs', directory))));
  assert.equal(native.imageSHA256, hash(image));
  const context = baseContext({ typeOptions: { resolveExternalType({ namespace, name }) {
    return context.types.intrinsic(`${namespace}.${name}`);
  } } });
  const module = (await context.loadFromStream(image)).manifestModule;
  const rejected = new Set(['SiblingIntermediate', 'ExternalIntermediate', 'OutsideChild', 'NarrowPublic', 'PrivateScope']);
  assert.equal(native.records.length, 13);
  assert.equal(new Set(native.records.map(record => record.scenario)).size, 13);
  for (const record of native.records) {
    const method = module.methodDefinition(record.token);
    assert.equal(method.name, 'M');
    assert.equal(method.declaringType.fullName, record.declaringType);
    if (rejected.has(record.scenario)) {
      assert.equal(record.error, 'TypeLoadException', record.scenario);
      await assert.rejects(method.getBaseDefinition(), error => error.code === LoadErrorCode.TypeLoad, record.scenario);
    } else {
      assert.equal(record.error, undefined, record.scenario);
      const expectedOwner = record.scenario === 'NewSlot' ? record.declaringType : `Fixture.${record.scenario}Root`;
      assert.equal(record.baseType, expectedOwner);
      assert.equal(await method.getBaseDefinition(), module.methodDefinition(record.baseToken), record.scenario);
    }
  }
  assert.equal(module.methodBodyReadCount, 0);
});
