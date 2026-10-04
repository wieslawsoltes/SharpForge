import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ManagedResourceReader, ResourceTypeCode } from '../packages/clr/src/index.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-resources/native-resources.json', import.meta.url)));

function normalize(value, code) {
  if (code === ResourceTypeCode.Char) return { codeUnit: value.charCodeAt(0) };
  if (value instanceof Uint8Array) return [...value];
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return '-0';
    if (!Number.isFinite(value)) return String(value);
  }
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item));
}

test('all native ResourceWriter primitive types and MSBuild resgen entries match keys, values and raw bytes', () => {
  assert.match(native.runtime, /^\.NET 10\./);
  for (const source of native.sources) {
    assert.equal(createHash('sha256').update(readFileSync(new URL('../' + source.path, import.meta.url))).digest('hex'), source.sha256);
  }
  assert.deepEqual(native.files.map(file => file.name), ['native.resources', 'resgen.resources']);
  const codes = new Set();
  for (const fixture of native.files) {
    const bytes = Buffer.from(fixture.image, 'base64');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256);
    const reader = new ManagedResourceReader(bytes);
    assert.deepEqual(reader.names, fixture.entries.map(entry => entry.name));
    for (const expected of fixture.entries) {
      const actual = reader.get(expected.name);
      codes.add(actual.typeCode);
      assert.deepEqual({ name: expected.name, typeName: actual.typeName,
        rawData: Buffer.from(reader.getRawData(expected.name).data).toString('base64'),
        serialized: actual.diagnostic !== null, value: normalize(actual.value, actual.typeCode) }, expected);
    }
    reader.dispose();
  }
  assert.deepEqual([...codes].sort((left, right) => left - right), [...Array.from({ length: 17 }, (_, index) => index), 32, 33, 64]);
});
