import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { encodeConstant, decodeConstant, MetadataBuilder, readMetadata, fieldSignature, codedIndex } from '@sharpforge/cil';

const revive = (key, value) => value?.utf16 ? String.fromCharCode(...value.utf16)
  : value?.integer !== undefined ? BigInt(value.integer)
  : value?.number !== undefined ? (value.number === '-NaN' ? -NaN : Number(value.number)) : value;

test('Constant values match Roslyn blobs, native SRM and reflection for fields and optional parameters', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/constants/roslyn.json', import.meta.url)), revive);
  assert.equal(data.runtime, '.NET 10.0.5');
  for (const [name, hash] of Object.entries(data.sourceSha256)) {
    const bytes = readFileSync(new URL(`./fixtures/constants/ConstantOracle/${name}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), hash);
  }
  assert.equal(data.cases.length, 23);
  for (const item of data.cases) {
    const bytes = Uint8Array.from(Buffer.from(item.blob, 'hex'));
    assert.deepEqual(item.value, item.srm, item.id);
    assert.deepEqual(encodeConstant(item.type, item.value), { type: item.type, bytes }, item.id);
    assert.deepEqual(decodeConstant(item.type, bytes), item.value, item.id);
  }
});

test('Constant encoding composes with existing named metadata row writers', () => {
  const builder = new MetadataBuilder('Constants');
  const field = builder.definitions.field({ Flags: 0x8056, Name: 'Answer', Signature: fieldSignature('int') });
  const value = encodeConstant('int', 42);
  builder.definitions.constant({ Type: value.type, Parent: field, Value: value.bytes });
  const metadata = readMetadata(builder.finish());
  const row = metadata.rows[11][0];
  assert.equal(row[1], codedIndex('HasConstant', field));
  assert.equal(decodeConstant(row[0], metadata.blob(row[2])), 42);
});

test('raw UTF-16, nullable reference encoding and Buffer subarrays preserve values', () => {
  for (const value of ['', '\ufeff', '\ud800\0\udfff', '空'.repeat(4097)]) {
    const encoded = encodeConstant('System.String', value, { maxBytes: value.length * 2 });
    assert.equal(decodeConstant(encoded.type, encoded.bytes, { maxBytes: value.length * 2 }), value);
  }
  for (const type of ['string', 'object', 18]) {
    assert.deepEqual(encodeConstant(type, null), { type: 18, bytes: new Uint8Array(4) });
    assert.equal(decodeConstant(18, new Uint8Array(4)), null);
  }
  const carrier = Buffer.from([255, 255, 42, 0, 0, 0, 255]);
  const bytes = carrier.subarray(2, 6);
  assert.equal(decodeConstant('int', bytes), 42);
  assert.deepEqual([...carrier], [255, 255, 42, 0, 0, 0, 255]);
});

test('Constant types, exact widths, null encodings and numeric ranges reject malformed inputs', () => {
  for (const type of [0, 1, 15, 16, 17, 19, 28, 0x108, -1, 1.5, 'decimal', 'void']) {
    assert.throws(() => decodeConstant(type, new Uint8Array(8)), error => error.code === 'MD0120');
  }
  for (const [type, width] of [[2, 1], [3, 2], [4, 1], [5, 1], [6, 2], [7, 2], [8, 4], [9, 4], [10, 8], [11, 8], [12, 4], [13, 8], [18, 4]]) {
    for (const size of [width - 1, width + 1]) {
      assert.throws(() => decodeConstant(type, new Uint8Array(size)), error => error.code === 'MD0122');
    }
  }
  assert.throws(() => decodeConstant('string', Uint8Array.of(1)), error => error.code === 'MD0122');
  assert.throws(() => decodeConstant(18, Uint8Array.of(1, 0, 0, 0)), error => error.code === 'MD0121');
  for (const [type, value] of [['byte', -1], ['sbyte', 128], ['int', 0.1], ['bool', 1], ['char', 'ab'],
    ['long', 2 ** 63], ['ulong', -1n], ['long', 1n << 63n], ['ulong', 1n << 64n], ['object', {}], [18, 0], ['string', 1]]) {
    assert.throws(() => encodeConstant(type, value), error => error.code === 'MD0121');
  }
});

test('Constant codecs enforce byte budgets and cancellation before allocating', () => {
  const signal = AbortSignal.abort();
  assert.throws(() => encodeConstant('string', 'x'.repeat(100), { maxBytes: 199 }), error => error.code === 'MD0123');
  assert.throws(() => decodeConstant('int', new Uint8Array(4), { maxBytes: 3 }), error => error.code === 'MD0123');
  for (const maxBytes of [-1, Infinity, 2 ** 31]) {
    assert.throws(() => encodeConstant('string', '', { maxBytes }), error => error.code === 'MD0123');
  }
  assert.throws(() => encodeConstant('int', 1, { signal }), error => error.code === 'MD0124');
  assert.throws(() => decodeConstant('int', new Uint8Array(4), { signal }), error => error.code === 'MD0124');
});
