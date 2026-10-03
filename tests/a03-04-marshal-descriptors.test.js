import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Writer, CilError, decodeMarshalDescriptor, marshalDiagnosticCatalog } from '@sharpforge/cil';

const decode = (bytes, options) => decodeMarshalDescriptor(Uint8Array.from(bytes), options);
const rejects = (bytes, code, options) => assert.throws(() => decode(bytes, options),
  error => error instanceof CilError && error.code === code);

test('native Roslyn descriptor bytes decode to reflection MarshalAs properties', () => {
  const root = new URL('./fixtures/marshal-descriptors/', import.meta.url);
  const reference = JSON.parse(readFileSync(new URL('native.json', root), 'utf8'));
  const source = readFileSync(new URL('oracle/Program.cs', root), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), reference.sourceSha256);
  assert.match(reference.sdk, /^10\./);
  assert.equal(reference.records.length, 14);
  for (const record of reference.records) {
    const descriptor = decodeMarshalDescriptor(Buffer.from(record.blob, 'hex'));
    assert.equal(descriptor.type, record.type, record.name);
    for (const key of ['sizeConstant', 'sizeParameterIndex', 'iidParameterIndex', 'variantType', 'managedTypeName', 'cookie']) {
      if (Object.hasOwn(descriptor, key)) assert.equal(descriptor[key], record.srmTail[key] ?? record[key], record.name + ':' + key);
    }
    if (descriptor.elementType && descriptor.elementType.type !== 0x50) assert.equal(descriptor.elementType.type, record.elementType);
    if (descriptor.userDefinedType) assert.equal(descriptor.userDefinedType, record.srmTail.userDefinedType);
  }
});

test('scalar storage types and absent optional tails retain exact semantics', () => {
  assert.deepEqual(decode([2]), { type: 2, name: 'Bool' });
  assert.deepEqual(decode([0x30]), { type: 0x30, name: 'LPUTF8Str' });
  assert.deepEqual(decode([0x2a]), { type: 0x2a, name: 'LPArray' });
  assert.deepEqual(decode([0x2a, 0x50, 1, 4, 1]), {
    type: 0x2a, name: 'LPArray', elementType: { type: 0x50, name: 'Default' }, sizeParameterIndex: 1, sizeConstant: 4, flags: 1,
  });
  assert.equal(decode([0x2a, 7, 0, 4, 0]).flags, 0, 'Encoded dummy parameter is not silently enabled');
  assert.deepEqual(decode([0x1e, 0]), { type: 0x1e, name: 'ByValArray', sizeConstant: 0 });
  assert.deepEqual(decode([0x19]), { type: 0x19, name: 'IUnknown' });
  assert.deepEqual(decode([0x1d]), { type: 0x1d, name: 'SafeArray' });
});

test('compressed counts cover all widths without allocating described arrays', () => {
  for (const size of [0, 127, 128, 16383, 16384, 0x1fffffff]) {
    const blob = new Writer().u8(0x1e).compressed(size).u8(3).finish();
    assert.equal(decodeMarshalDescriptor(blob).sizeConstant, size);
  }
});

test('custom marshal strings are owned data and do not resolve or activate types', () => {
  const bytes = Buffer.from([0x2c, 0, 0, 3, 65, 0, 66, 0]);
  const result = decodeMarshalDescriptor(bytes.subarray(0));
  bytes.fill(0);
  assert.deepEqual(result, { type: 0x2c, name: 'CustomMarshaler', guid: '', nativeTypeName: '', managedTypeName: 'A\0B', cookie: '' });
  assert.equal(decode([0x2c, 0, 0, 0, 3, 0xef, 0xbb, 0xbf]).cookie, '\ufeff');
});

test('malformed tails, invalid UTF-8 and noncanonical integers have stable diagnostics', () => {
  for (const bytes of [[], [2, 0], [0x1e], [0x17], [0x17, 0x80], [0x17, 0x80, 0],
    [0x17, 0xc0, 0, 0, 1], [0x17, 0xe0], [0x2a, 3, 1, 2, 1, 0], [0x2c, 0, 0, 0],
    [0x2c, 0, 0, 1, 0xff, 0], [0x2c, 0, 0, 4, 1], [0x1d, 3, 0xff]]) rejects(bytes, 'MD0130');
  for (const bytes of [[0], [1], [0x50], [0xff], [0x2a, 0x7f]]) rejects(bytes, 'MD0131');
  assert.throws(() => decodeMarshalDescriptor('blob'), { code: 'MD0130' });
  assert(Object.isFrozen(marshalDiagnosticCatalog));
});

test('byte and string budgets reject before decoding and support cancellation', () => {
  rejects([2], 'MD0132', { maxBytes: 0 });
  rejects([0x2c, 0, 0, 2, 65, 66, 0], 'MD0132', { maxStringBytes: 1 });
  for (const value of [-1, 0.5, NaN, Infinity, 16 * 1024 * 1024 + 1]) rejects([2], 'MD0132', { maxBytes: value });
  const controller = new AbortController();
  controller.abort();
  rejects([2], 'MD0133', { signal: controller.signal });
  assert.equal(decode([2], { maxBytes: 1, maxStringBytes: 0 }).name, 'Bool');
});
