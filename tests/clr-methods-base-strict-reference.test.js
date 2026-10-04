import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { LoadErrorCode } from '../packages/clr/src/index.js';
import { baseContext } from './clr-methods-base-fixtures.js';

test('CLR same-assembly strict roots and inaccessible overrides agree with native loading', async () => {
  const directory = new URL('./fixtures/clr-method-base-strict/', import.meta.url);
  const native = JSON.parse(readFileSync(new URL('native-method-bases.json', directory)));
  const hash = value => createHash('sha256').update(value).digest('hex');
  const image = Buffer.from(native.image, 'base64');
  assert.equal(native.sourceSHA256, hash(readFileSync(new URL('Program.cs', directory))));
  assert.equal(native.imageSHA256, hash(image));
  const context = baseContext({ typeOptions: { resolveExternalType({ namespace, name }) {
    return context.types.intrinsic(`${namespace}.${name}`);
  } } });
  const module = (await context.loadFromStream(image)).manifestModule;
  const rejected = new Set(['PrivateBase', 'NarrowPublic', 'LateralFamily', 'NarrowFamilyOrAssembly']);
  assert.equal(native.records.length, 12);
  let failures = 0;
  for (const record of native.records) {
    const name = record.declaringType.slice('Fixture.'.length, -'Child'.length);
    const method = module.methodDefinition(record.token);
    assert.equal(method.name, 'M');
    assert.equal(method.declaringType.fullName, record.declaringType);
    if (rejected.has(name)) {
      failures++;
      assert.equal(record.error, 'TypeLoadException', name);
      await assert.rejects(method.getBaseDefinition(), error => error.code === LoadErrorCode.TypeLoad, name);
    } else {
      assert.equal(record.error, undefined, name);
      assert.equal(record.baseType, `Fixture.${name}Root`);
      assert.equal(await method.getBaseDefinition(), module.methodDefinition(record.baseToken), name);
    }
  }
  assert.equal(failures, 4);
  assert.equal(module.methodBodyReadCount, 0);
});
