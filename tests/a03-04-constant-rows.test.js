import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MetadataBuilder, readMetadata, readPE, decodeConstant, fieldSignature, propertySignature, codedIndex, decodeCoded,
} from '@sharpforge/cil';
import { constantRowImage } from './fixtures/constant-rows/image.mjs';

function parents(builder) {
  return [
    builder.definitions.field({ Flags: 0x56, Name: 'Answer', Signature: fieldSignature('int') }),
    builder.definitions.parameter({ Flags: 0x10, Sequence: 1, Name: 'value' }),
    builder.addRow('Property', { Flags: 0x200, Name: 'Default', Type: propertySignature('string', []) }),
  ];
}

test('typed Constant rows set matching Field, Param and Property HasDefault flags and survive sorting', () => {
  const builder = new MetadataBuilder('TypedConstants');
  const tokens = parents(builder);
  const values = [{ Type: 'int', Value: 42 }, { Type: 'int', Value: -7 }, { Type: 'string', Value: 'text' }];
  for (const index of [2, 0, 1]) {
    const token = builder.definitions.constantValue({ Parent: tokens[index], ...values[index] });
    assert.equal(token >>> 24, 11);
  }
  const metadata = readMetadata(builder.finish());
  assert.deepEqual(tokens.map(token => metadata.row(token)[0]), [0x8056, 0x1010, 0x1200]);
  assert.deepEqual(metadata.rows[11].map(row => row[1]), tokens.map(token => codedIndex('HasConstant', token)));
  metadata.rows[11].forEach((row, index) => assert.equal(decodeConstant(row[0], metadata.blob(row[2])), values[index].Value));
});

test('emitted Constant parents agree with native SRM default lookup, flags and values', () => {
  const native = JSON.parse(readFileSync(new URL('./fixtures/constant-rows/native.json', import.meta.url)));
  const metadata = readPE(constantRowImage(), { inspection: true }).metadata;
  const rows = metadata.rows[11].map(row => {
    const parent = decodeCoded('HasConstant', row[1]);
    const bytes = metadata.blob(row[2]);
    return { parent, flags: metadata.row(parent)[0], type: row[0], blob: Buffer.from(bytes).toString('hex').toUpperCase(),
      value: decodeConstant(row[0], bytes) };
  });
  assert.deepEqual(rows, native.rows);
});

test('typed Constant failures leave heaps, rows and flags unchanged', () => {
  const builder = new MetadataBuilder();
  const [field] = parents(builder);
  const before = builder.finish();
  for (const [values, options, code] of [
    [{ Parent: 0x06000001, Type: 'int', Value: 1 }, {}, 'MD0125'],
    [{ Parent: 0x04000000, Type: 'int', Value: 1 }, {}, 'MD0125'],
    [{ Parent: 0x04000002, Type: 'int', Value: 1 }, {}, 'MD0125'],
    [{ Parent: field, Type: 'byte', Value: 256 }, {}, 'MD0121'],
    [{ Parent: field, Type: 'int', Value: 1, Unknown: 0 }, {}, 'MD0121'],
    [{ Parent: field, Type: 'int', Value: 1 }, { maxBytes: 3 }, 'MD0123'],
    [{ Parent: field, Type: 'int', Value: 1 }, { maxConstants: 0 }, 'MD0123'],
    [{ Parent: field, Type: 'int', Value: 1 }, { signal: AbortSignal.abort() }, 'MD0124'],
  ]) {
    assert.throws(() => builder.definitions.constantValue(values, options), error => error.code === code);
    assert.deepEqual(builder.finish(), before);
  }
});

test('typed Constant rows reject duplicates including appended raw rows and bound index growth', () => {
  const builder = new MetadataBuilder();
  const [field, parameter, property] = parents(builder);
  builder.definitions.constantValue({ Parent: field, Type: 'int', Value: 1 });
  builder.definitions.constant({ Type: 8, Parent: parameter, Value: Uint8Array.of(2, 0, 0, 0) });
  const before = builder.finish();
  for (const Parent of [field, parameter]) {
    assert.throws(() => builder.definitions.constantValue({ Parent, Type: 'int', Value: 3 }), error => error.code === 'MD0126');
    assert.deepEqual(builder.finish(), before);
  }
  assert.throws(() => builder.definitions.constantValue({ Parent: property, Type: 'string', Value: null },
    { maxConstants: 2 }), error => error.code === 'MD0123');
  builder.definitions.constantValue({ Parent: property, Type: 'string', Value: null }, { maxConstants: 3 });
  const metadata = readMetadata(builder.finish());
  const last = metadata.rows[11].at(-1);
  assert.equal(last[0], 18);
  assert.equal(decodeConstant(last[0], metadata.blob(last[2])), null);
});

test('Constant indexes belong to their builder and reject replaced raw tables', () => {
  const first = new MetadataBuilder();
  const second = new MetadataBuilder();
  for (const builder of [first, second]) {
    const [Parent] = parents(builder);
    builder.definitions.constantValue({ Parent, Type: 'int', Value: 1 });
  }
  first.rows[11] = first.rows[11].map(row => [...row]);
  assert.throws(() => first.definitions.constantValue({ Parent: 0x08000001, Type: 'int', Value: 1 }), error => error.code === 'MD0127');
  second.definitions.constantValue({ Parent: 0x08000001, Type: 'int', Value: 2 });
});

test('malformed raw Constant rows reject explicitly before adding another default', () => {
  for (const row of [null, [], [8, 0, 0], [8, 7, 0], [8, 0x4000004, 0], [8, 8, 0]]) {
    const builder = new MetadataBuilder();
    const [Parent] = parents(builder);
    builder.add(11, row);
    assert.throws(() => builder.definitions.constantValue({ Parent, Type: 'int', Value: 1 }), error => error.code === 'MD0127');
  }
});

test('invalid raw Constant tables reject before allocating a blob or changing owner flags', () => {
  for (const rows of [null, false, 0, '', {}, 'rows']) {
    const builder = new MetadataBuilder();
    const [Parent] = parents(builder);
    builder.rows[11] = rows;
    const blobLength = builder.heaps.blobs.length;
    assert.throws(() => builder.definitions.constantValue({ Parent, Type: 'int', Value: 42 }), error => error.code === 'MD0127');
    assert.equal(builder.heaps.blobs.length, blobLength);
    assert.equal(builder.rows[4][0][0], 0x56);
    assert.equal(builder.rows[11], rows);
  }
});

test('appended Constant rows are indexed once across many typed writes', () => {
  const builder = new MetadataBuilder();
  let reads = 0;
  builder.rows[11] = new Proxy([], { get(rows, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
    return Reflect.get(rows, key, receiver);
  } });
  const signature = fieldSignature('int');
  for (let index = 0; index < 500; index++) {
    const Parent = builder.definitions.field({ Flags: 0x56, Name: `F${index}`, Signature: signature });
    if (index < 200) builder.definitions.constant({ Parent, Type: 8, Value: Uint8Array.of(1, 0, 0, 0) });
    else builder.definitions.constantValue({ Parent, Type: 'int', Value: index });
  }
  assert.equal(reads, 200, 'Existing rows must not be rescanned for each new value');
});
