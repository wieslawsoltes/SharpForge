import test from 'node:test';
import assert from 'node:assert/strict';
import { PdbGuids, readCustomDebugInformation as decode, writeCustomDebugInformation as encode,
  PortablePdbBuilder, readPortablePdb } from '@sharpforge/symbols';
import { codedIndex, token } from '@sharpforge/cil';

const cases = [
  [PdbGuids.tupleNames, { names: ['left', null, 'right', '𝄞'] }],
  [PdbGuids.defaultNamespace, { namespace: 'Example.Project' }],
  [PdbGuids.compilationOptions, { options: { language: 'CSharp', 'compiler-version': '5.0.0', empty: '' } }],
  [PdbGuids.compilationReferences, { references: [{ fileName: 'library.dll', aliases: ['global', 'custom'], flags: 3,
    timestamp: 0xffffffff, fileSize: 4096, mvid: '12345678-1234-5678-9abc-123456789abc' }] }],
  [PdbGuids.typeDocuments, { documents: [1, 128, 16384] }],
  [PdbGuids.primaryConstructor, { primaryConstructor: true }],
];
for (const [kind, expected] of cases) test('compilation CDI structured round trip: ' + kind, () => {
  const bytes = encode(kind, expected);
  assert.deepEqual(decode(kind, bytes), expected);
  assert.deepEqual(encode(kind, decode(kind, bytes)), bytes);
});

test('dynamic flags use little-endian bit packing and trim trailing zero bytes', () => {
  const flags = [true, false, true, false, false, false, false, true, true, false, false, false, false, false, false, false];
  assert.deepEqual(encode(PdbGuids.dynamicLocals, { flags: [...flags, false, false] }), new Uint8Array([133, 1]));
  assert.deepEqual(decode(PdbGuids.dynamicLocals, new Uint8Array([133, 1])).flags, flags);
  assert.deepEqual(encode(PdbGuids.dynamicLocals, { flags: [false] }), new Uint8Array());
});

test('unknown CDI payloads survive read/write and are copied', () => {
  const kind = '11111111-2222-3333-4444-555555555555';
  const bytes = new Uint8Array([255, 0, 1, 2]);
  const decoded = decode(kind, bytes);
  assert.deepEqual(decoded.bytes, bytes);
  decoded.bytes[0] = 0;
  assert.equal(bytes[0], 255);
  assert.deepEqual(encode(kind, { bytes }), bytes);
});

test('compilation codecs reject truncated strings, duplicate options and invalid marker data', () => {
  const utf8 = value => new TextEncoder().encode(value);
  assert.throws(() => decode(PdbGuids.tupleNames, utf8('unterminated')), /Unterminated/);
  assert.throws(() => decode(PdbGuids.compilationOptions, utf8('a\0b\0a\0c\0')), /Duplicate/);
  assert.throws(() => decode(PdbGuids.primaryConstructor, new Uint8Array([1])), /empty/);
  assert.throws(() => decode(PdbGuids.compilationReferences, utf8('a\0\0')), /Truncated/);
  assert.throws(() => decode(PdbGuids.typeDocuments, new Uint8Array([0])), /document id/);
  assert.throws(() => encode(PdbGuids.tupleNames, { names: ['bad\0name'] }), /Invalid/);
  assert.throws(() => decode(PdbGuids.dynamicLocals, new Uint8Array(2), { maxRecords: 8 }), /limit/);
});

test('Portable PDB reader decorates CDI with structured compiler records', () => {
  const builder = new PortablePdbBuilder();
  for (const [kind, record] of cases.filter(([kind]) => kind !== PdbGuids.typeDocuments)) {
    builder.add(55, [codedIndex('HasCustomDebugInformation', token(0, 1)), builder.guid(kind), builder.blob(encode(kind, record))]);
  }
  const parsed = readPortablePdb(builder.finish({ 0: 1 }, 0).bytes);
  assert.deepEqual(parsed.custom.find(record => record.kind === PdbGuids.tupleNames).names, ['left', null, 'right', '𝄞']);
});
