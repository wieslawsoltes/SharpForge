import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MetadataBuilder, readMetadata, Writer, codedIndex } from '@sharpforge/cil';
import { loadSymbols, readPortablePdb, emitPortablePdb, attachPortablePdb } from '@sharpforge/symbols';
import { bindConstantTypes } from '../packages/symbols/src/constant-binding.js';
import { decodeConstant } from '../packages/symbols/src/constant-reader.js';

const directory = new URL('./fixtures/portable-pdb-local-constants/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8'));
const assembly = new Uint8Array(readFileSync(new URL('LocalConstants.dll', directory)));
const pdb = new Uint8Array(readFileSync(new URL('LocalConstants.pdb', directory)));
const native = reference.native.constants.find((constant) => constant.name === 'Enumeration');
const standalone = readPortablePdb(pdb);
const method = standalone.scopes.find((scope) =>
  scope.constants.some((constant) => constant.name === 'Enumeration'),
).methodToken;

function signature(kind, bytes, token = native.enumTypeToken) {
  return new Writer().u8(kind).bytes(bytes).compressed(codedIndex('TypeDefOrRef', token)).finish();
}

function loadConstant(bytes) {
  const symbols = emitPortablePdb(assembly, {
    methods: [{ token: method, constants: [{ name: 'Enumeration', signature: bytes }] }],
  }).bytes;
  return loadSymbols(attachPortablePdb(assembly, symbols), symbols).constants[0];
}

test('bound local enum matches retained native SRM scalar and validates its declared underlying type', () => {
  const result = loadSymbols(assembly, pdb).constants.find((constant) => constant.name === 'Enumeration');
  assert.equal(native.code, 6);
  assert.equal(result.type, 'short');
  assert.equal(result.value, Number(native.value));
  assert.equal(result.enumTypeToken, native.enumTypeToken);
  assert.equal(result.enumTypeVerified, true);
  assert.equal(standalone.constants.find((constant) => constant.name === 'Enumeration').enumTypeVerified, false);
  assert.deepEqual(result.signature, new Uint8Array(Buffer.from(native.signature, 'hex')));
});

test('a local enum cannot silently use a different scalar kind', () => {
  assert.throws(() => loadConstant(signature(8, [46, 251, 255, 255])), /scalar kind does not match/);
  const prefix = new Writer().u8(32).compressed(codedIndex('TypeDefOrRef', native.enumTypeToken)).finish();
  const modified = loadConstant(new Uint8Array([...prefix, ...signature(6, [46, 251])]));
  assert.equal(modified.enumTypeVerified, true);
  assert.deepEqual(modified.customModifiers, [{ required: false, typeToken: native.enumTypeToken }]);
});

function enumMetadata({ fieldType = [6, 6], flags = 0x606, name = 'value__', baseName = 'Enum', pointers } = {}) {
  const builder = new MetadataBuilder('LocalEnums', { uncompressed: !!pointers });
  const scope = builder.add(35, [
    10,
    0,
    0,
    0,
    0,
    builder.blob(Buffer.from('b03f5f7f11d50a3a', 'hex')),
    builder.string('System.Runtime'),
    0,
    0,
  ]);
  const base = builder.add(1, [
    codedIndex('ResolutionScope', scope),
    builder.string(baseName),
    builder.string('System'),
  ]);
  const type = builder.add(2, [0x101, builder.string('Number'), 0, codedIndex('TypeDefOrRef', base), 1, 1]);
  builder.add(4, [0x56, builder.string('Value'), builder.blob(new Uint8Array([6, 0x11, 4]))]);
  builder.add(4, [flags, builder.string(name), builder.blob(new Uint8Array(fieldType))]);
  for (const field of pointers ?? []) builder.add(3, [field]);
  const metadata = readMetadata(builder.finish());
  const constant = decodeConstant(signature(6, [46, 251], type));
  return { metadata, constant };
}

test('pointer lists and modified field signatures resolve once without borrowing metadata into results', () => {
  const { metadata, constant } = enumMetadata({ pointers: [2, 1], fieldType: [6, 32, 5, 6] });
  let lists = 0;
  const list = metadata.list;
  metadata.list = function (...args) {
    lists++;
    return list.apply(this, args);
  };
  const second = { ...constant };
  bindConstantTypes([constant, second], metadata);
  assert.equal(lists, 1);
  assert.equal(constant.enumTypeVerified, true);
  assert.equal(second.enumTypeVerified, true);
  metadata.rows[4][1][0] = 0;
  assert.equal(constant.enumTypeVerified, true);
  assert.equal(constant.value, -1234);
});

test('external TypeRef and constructed TypeSpec enums keep decoded scalars explicitly unverified', () => {
  for (const token of [0x01000001, 0x1b000001]) {
    const constant = decodeConstant(signature(6, [46, 251], token));
    bindConstantTypes([constant], { row: () => assert.fail('External enum resolution was attempted') });
    assert.equal(constant.decoded, true);
    assert.equal(constant.value, -1234);
    assert.equal(constant.enumTypeVerified, false);
  }
});

test('wrong base identity and malformed enum instance fields fail explicitly', () => {
  for (const options of [
    { baseName: 'Object' },
    { flags: 6 },
    { flags: 0x616 },
    { name: 'wrong' },
    { fieldType: [6, 14] },
    { fieldType: [6, 6, 0] },
    { fieldType: [0, 0, 1] },
    { pointers: [2, 2] },
    { pointers: [1] },
  ]) {
    const { metadata, constant } = enumMetadata(options);
    assert.throws(() => bindConstantTypes([constant], metadata));
  }
  const { metadata, constant } = enumMetadata();
  metadata.rows[35][0][5] = 0;
  assert.throws(() => bindConstantTypes([constant], metadata), /declared framework System.Enum required/);
  const duplicate = enumMetadata();
  duplicate.metadata.rows[4][0] = [...duplicate.metadata.rows[4][1]];
  assert.throws(() => bindConstantTypes([duplicate.constant], duplicate.metadata), /one special value__/);
});

test('field range and aggregate budgets reject before expanding lists', () => {
  for (const start of [0, 4]) {
    const { metadata, constant } = enumMetadata();
    metadata.rows[2][0][4] = start;
    assert.throws(() => bindConstantTypes([constant], metadata), /Invalid enum field list range/);
  }
  for (const [typeCount, fieldsPerType, expected] of [
    [1, 4097, /field count limit/],
    [17, 4096, /field count limit/],
    [1025, 1, /type count limit/],
  ]) {
    const { metadata, constant } = enumMetadata();
    metadata.rows[2] = Array.from({ length: typeCount }, (_, index) => [0x101, 0, 0, 5, 1 + index * fieldsPerType, 1]);
    metadata.counts[2] = typeCount;
    metadata.counts[4] = typeCount * fieldsPerType;
    metadata.list = () => assert.fail('List allocated before preflight');
    const constants = Array.from({ length: typeCount }, (_, index) => ({
      ...constant,
      enumTypeToken: 0x02000001 + index,
    }));
    assert.throws(() => bindConstantTypes(constants, metadata), expected);
  }
});

test('signature and name budgets run before AST/string expansion', () => {
  const signatureCase = enumMetadata({ fieldType: new Uint8Array(4097) });
  assert.throws(() => bindConstantTypes([signatureCase.constant], signatureCase.metadata), /signature byte limit/);
  const nameCase = enumMetadata({ name: 'x'.repeat(3073) });
  const nameIndex = nameCase.metadata.rows[4][1][1];
  const string = nameCase.metadata.string;
  nameCase.metadata.string = (index) => {
    assert.notEqual(index, nameIndex, 'Over-limit field name was decoded');
    return string(index);
  };
  assert.throws(() => bindConstantTypes([nameCase.constant], nameCase.metadata), /Enum field name exceeds/);
});
