import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { functionPointerContext } from './clr-methods-base-function-pointer-fixtures.js';

test('CLR function-pointer override roots match independent native positive and mismatch observations', async () => {
  const directory = new URL('./fixtures/clr-method-base-function-pointers/', import.meta.url);
  const native = JSON.parse(readFileSync(new URL('native-method-bases.json', directory)));
  const hash = value => createHash('sha256').update(value).digest('hex');
  const image = Buffer.from(native.image, 'base64');
  assert.equal(native.sourceSHA256, hash(readFileSync(new URL('Program.cs', directory))));
  assert.equal(native.imageSHA256, hash(image));
  const context = functionPointerContext();
  const module = (await context.loadFromStream(image)).manifestModule;
  assert.equal(native.records.length, 18);
  assert.equal(native.records.filter(record => record.declaringType === 'Fixture.Child').length, 12);
  const expected = new Map([['Fixture.Child', 'Fixture.Root'], ...['Kind', 'Convention', 'Arity', 'Return', 'Parameter', 'Nested']
    .map(name => [`Fixture.${name}Child`, `Fixture.${name}Root`])]);
  for (const record of native.records) {
    assert.equal(record.error, undefined, `${record.declaringType}: ${record.error}`);
    assert.equal(record.baseType, expected.get(record.declaringType));
    const method = module.methodDefinition(record.token);
    assert.equal(method.name, record.name);
    assert.equal(await method.getBaseDefinition(), module.methodDefinition(record.baseToken), record.declaringType);
    assert.equal((await method.getBaseDefinition()).declaringType.fullName, record.baseType);
  }
  assert.equal(module.methodBodyReadCount, 0);
});
