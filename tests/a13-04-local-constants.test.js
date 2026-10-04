import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Writer, codedIndex } from '@sharpforge/cil';
import { readPortablePdb } from '@sharpforge/symbols';
import { decodeConstant } from '../packages/symbols/src/constant-reader.js';
import { readLocalConstants } from '../packages/symbols/src/constant-rows.js';

const directory = new URL('./fixtures/portable-pdb-local-constants/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8'));
const assembly = readFileSync(new URL('LocalConstants.dll', directory));
const pdb = readFileSync(new URL('LocalConstants.pdb', directory));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (...bytes) => new Uint8Array(bytes);
const typeToken = 0x01000001;
const encodedType = codedIndex('TypeDefOrRef', typeToken);
const counts = { 1: 1, 2: 1, 27: 1 };

test('native local constants pin compiler/source/blob provenance and scalar values', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.match(fixture.reference.compilerVersion, /^5\.3\./);
  assert.equal(hash(assembly), fixture.reference.assemblySha256);
  assert.equal(hash(pdb), fixture.reference.pdbSha256);
  const source = readFileSync(
    new URL('../packages/symbols/interop/LocalConstants/Program.cs', import.meta.url),
    'utf8',
  );
  assert.equal(hash(source.replaceAll('\r\n', '\n')), fixture.reference.sourceSha256);
  const constants = readPortablePdb(pdb).constants;
  assert.equal(constants.length, 18);
  for (const native of fixture.native.constants) {
    const result = constants.find((constant) => constant.name === native.name);
    assert.equal(Buffer.from(result.signature).toString('hex').toUpperCase(), native.signature);
    if (native.name === 'Decimal') {
      assert.equal(result.decoded, false);
      assert.equal(result.reason, 'type-metadata-required');
      assert.equal(result.typeToken, native.typeToken);
    } else {
      assert.equal(result.decoded, true);
      assert.equal(result.value === null ? null : String(result.value), native.value);
      assert.equal(result.enumTypeToken ?? null, native.enumTypeToken);
      if (native.typeToken !== null) assert.equal(result.typeToken, native.typeToken);
    }
  }
});

test('custom modifiers preserve order and enum handles expose tokens without changing scalar shape', () => {
  const signature = blob(31, encodedType, 32, 4, 8, 42, 0, 0, 0, encodedType);
  assert.deepEqual(decodeConstant(signature, { counts }), {
    type: 'int',
    value: 42,
    decoded: true,
    enumType: encodedType,
    enumTypeToken: typeToken,
    enumTypeVerified: false,
    customModifiers: [
      { required: true, typeToken },
      { required: false, typeToken: 0x02000001 },
    ],
  });
  assert.equal(decodeConstant(blob(3, 0, 216)).value, 0xd800);
  assert.equal(decodeConstant(blob(10, 1, 0, 0, 0, 0, 0, 0, 0)).value, 1n);
  assert.equal(decodeConstant(blob(11, 1, 0, 0, 0, 0, 0, 0, 0)).value, 1n);
});

test('UTF-16 strings preserve BOM, unmatched surrogates and embedded NUL; null remains distinct', () => {
  const value = '\ufeffA\ud800\0\udfff';
  const writer = new Writer().u8(14);
  for (let index = 0; index < value.length; index++) writer.u16(value.charCodeAt(index));
  assert.equal(decodeConstant(writer.finish()).value, value);
  assert.equal(decodeConstant(blob(14)).value, '');
  assert.equal(decodeConstant(blob(14, 255)).value, null);
  assert.throws(() => decodeConstant(blob(14, 0)), /length|blob/i);
});

test('malformed constants reject truncation, trailing bytes and invalid type handles', () => {
  for (const signature of [
    blob(),
    blob(0),
    blob(8, 1),
    blob(2, 2),
    blob(28, 0),
    blob(12, 0, 0, 0, 0, 4),
    blob(8, 0, 0, 0, 0, 0),
    blob(8, 0, 0, 0, 0, 7),
    blob(8, 0, 0, 0, 0, 4, 4),
    blob(18, 0),
    blob(18, 9),
    blob(31, 0, 28),
    blob(32, encodedType),
  ]) {
    assert.throws(() => decodeConstant(signature, { counts }));
  }
  const overflow = new Writer().u8(18).compressed(0x4000000).finish();
  assert.throws(() => decodeConstant(overflow), /type handle/);
});

test('general signatures retain owned raw bytes and explicit unresolved type payloads', () => {
  assert.deepEqual(decodeConstant(blob(18, encodedType), { counts }), {
    type: 'class',
    value: null,
    decoded: true,
    enumType: null,
    typeToken,
  });
  for (const kind of [17, 18]) {
    const bytes = Buffer.from([kind, encodedType, 42]);
    const result = decodeConstant(bytes, { counts });
    bytes.fill(0);
    assert.equal(result.decoded, false);
    assert.equal(result.reason, 'type-metadata-required');
    assert.equal(result.typeToken, typeToken);
    assert.equal(result.defaultValue, false);
    assert.deepEqual(result.raw, blob(kind, encodedType, 42));
  }
  assert.equal(decodeConstant(blob(17, encodedType), { counts }).defaultValue, true);
});

test('modifier, row and aggregate byte limits apply before expansion and copying', () => {
  const modified = blob(31, encodedType, 32, encodedType, 28);
  assert.throws(() => decodeConstant(modified, { maxModifiers: 1 }), /modifier limit/);
  assert.equal(decodeConstant(modified, { maxModifiers: 2 }).customModifiers.length, 2);
  const signature = Buffer.from([8, 42, 0, 0, 0]);
  const metadata = {
    rows: {
      52: [
        [1, 1],
        [1, 1],
      ],
    },
    externalCounts: counts,
    blob: () => signature,
    streams: new Map([['#Strings', blob(0, 120, 0)]]),
    string: () => {
      throw Error('name decoded before aggregate budget');
    },
  };
  assert.throws(() => readLocalConstants(metadata, { maxConstantBytes: 9 }), /byte limit exceeded/);
  assert.throws(() => readLocalConstants(metadata, { maxConstantEntries: 1 }), /entry limit exceeded/);
  const manyModifiers = { ...metadata, blob: () => modified };
  assert.throws(() => readLocalConstants(manyModifiers, { maxConstantEntries: 5 }), /entry limit exceeded/);
  const constants = readLocalConstants({ ...metadata, string: () => 'x' }, { maxConstantBytes: 10 });
  signature.fill(0);
  assert.deepEqual(constants[0].signature, blob(8, 42, 0, 0, 0));
  constants[0].signature.fill(0);
  assert.deepEqual(constants[1].signature, blob(8, 42, 0, 0, 0));
  for (const option of ['maxConstantBytes', 'maxConstantEntries', 'maxConstantModifiers']) {
    for (const value of [-1, NaN, 1.5, Number.MAX_SAFE_INTEGER])
      assert.throws(() => readPortablePdb(pdb, { [option]: value }), /Invalid local constant/);
  }
  assert.throws(() => readPortablePdb(pdb, { maxConstantEntries: 17 }), /entry limit exceeded/);
  const total = fixture.native.constants.reduce((sum, constant) => sum + constant.signature.length / 2, 0);
  assert.throws(() => readPortablePdb(pdb, { maxConstantBytes: total - 1 }), /byte limit exceeded/);
  assert.equal(readPortablePdb(pdb, { maxConstantBytes: total }).constants.length, 18);
});

test('constant names are bounded before metadata string decoding', () => {
  const heap = new Uint8Array(4096).fill(65);
  heap[0] = 0;
  const metadata = {
    rows: { 52: [[1, 1]] },
    externalCounts: {},
    blob: () => blob(28),
    streams: new Map([['#Strings', heap]]),
    string: () => {
      throw Error('name decoded before limit');
    },
  };
  assert.throws(() => readLocalConstants(metadata), /Local constant name exceeds length limit/);
});
