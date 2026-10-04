import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { baseContext } from './clr-methods-base-fixtures.js';

test('CLR modified override roots match independently emitted native signatures', async () => {
  const directory = new URL('./fixtures/clr-method-base-modifiers/', import.meta.url);
  const native = JSON.parse(readFileSync(new URL('native-method-bases.json', directory)));
  const hash = value => createHash('sha256').update(value).digest('hex');
  const image = Buffer.from(native.image, 'base64');
  assert.equal(native.sourceSHA256, hash(readFileSync(new URL('Program.cs', directory))));
  assert.equal(native.imageSHA256, hash(image));
  assert.match(native.harnessSHA256, /^[a-f0-9]{64}$/);
  const context = baseContext({ typeOptions: { resolveExternalType({ namespace, name }) {
    return context.types.intrinsic(`${namespace}.${name}`);
  } } });
  const module = (await context.loadFromStream(image)).manifestModule;
  assert.equal(native.records.length, 10);
  assert.equal(new Set(native.records.map(record => record.name)).size, 10);
  for (const record of native.records) {
    assert.equal(record.baseType, 'Fixture.Root');
    const method = module.methodDefinition(record.token);
    assert.equal(method.name, record.name);
    assert.equal(await method.getBaseDefinition(), module.methodDefinition(record.baseToken), record.name);
    assert.equal((await method.getBaseDefinition()).declaringType.fullName, record.baseType);
  }
  assert.equal(module.methodBodyReadCount, 0);
});
