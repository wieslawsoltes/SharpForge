import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Writer, codedIndex } from '@sharpforge/cil';
import { loadSymbols, readPortablePdb, emitPortablePdb, attachPortablePdb } from '@sharpforge/symbols';
import { bindConstantTypes } from '../packages/symbols/src/constant-binding.js';

const directory = new URL('./fixtures/portable-pdb-local-constants/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8'));
const assembly = new Uint8Array(readFileSync(new URL('LocalConstants.dll', directory)));
const pdb = new Uint8Array(readFileSync(new URL('LocalConstants.pdb', directory)));
const native = fixture.native.constants.find((constant) => constant.name === 'Decimal');
const standalone = readPortablePdb(pdb);
const method = standalone.scopes.find((scope) =>
  scope.constants.some((constant) => constant.name === 'Decimal'),
).methodToken;
const original = standalone.constants.find((constant) => constant.name === 'Decimal');
const signature = (flags, coefficient, kind = 17) =>
  new Writer()
    .u8(kind)
    .compressed(codedIndex('TypeDefOrRef', native.typeToken))
    .u8(flags)
    .u32(Number(coefficient & 0xffffffffn))
    .u32(Number((coefficient >> 32n) & 0xffffffffn))
    .u32(Number((coefficient >> 64n) & 0xffffffffn))
    .finish();
function loadConstant(bytes) {
  const symbols = emitPortablePdb(assembly, {
    methods: [{ token: method, constants: [{ name: 'Amount', signature: bytes }] }],
  }).bytes;
  return loadSymbols(attachPortablePdb(assembly, symbols), symbols).constants[0];
}

test('bound decimal constant matches native SRM value with exact coefficient and scale', () => {
  const symbols = loadSymbols(assembly, pdb);
  const result = symbols.constants.find((constant) => constant.name === 'Decimal');
  assert.equal(native.typeName, 'System.Decimal');
  assert.equal(result.type, 'decimal');
  assert.equal(result.decoded, true);
  assert.equal(result.reason, null);
  assert.equal(result.value, native.value);
  assert.equal(result.value, '-123.4500');
  assert.deepEqual(result.decimal, { coefficient: 1234500n, scale: 4, negative: true });
  assert.equal(
    symbols.scopes
      .find((scope) => scope.methodToken === method)
      .constants.find((constant) => constant.name === 'Decimal'),
    result,
  );
  assert.deepEqual(result.signature, original.signature);
  assert.equal(original.decoded, false);
  assert.equal(original.reason, 'type-metadata-required');
});

test('decimal limits and negative zero retain all 96 bits and the scale without floating-point conversion', () => {
  const maximum = (1n << 96n) - 1n;
  assert.equal(loadConstant(signature(0, maximum)).value, '79228162514264337593543950335');
  assert.equal(loadConstant(signature(28, 1n)).value, '0.0000000000000000000000000001');
  const negativeZero = loadConstant(signature(0x80 | 2, 0n));
  assert.equal(negativeZero.value, '-0.00');
  assert.deepEqual(negativeZero.decimal, { coefficient: 0n, scale: 2, negative: true });
});

test('decimal custom modifiers survive identity binding', () => {
  const bytes = signature(1, 15n);
  const prefix = new Writer().u8(32).compressed(codedIndex('TypeDefOrRef', native.typeToken)).finish();
  const result = loadConstant(new Uint8Array([...prefix, ...bytes]));
  assert.equal(result.value, '1.5');
  assert.deepEqual(result.customModifiers, [{ required: false, typeToken: native.typeToken }]);
});

test('decimal payload length, scale and value-type marker are checked after identity binding', () => {
  const valid = signature(0, 1n);
  for (const bytes of [
    valid.subarray(0, valid.length - 1),
    new Uint8Array([...valid, 0]),
    signature(29, 1n),
    signature(127, 1n),
    signature(0, 1n, 18),
  ]) {
    assert.throws(() => loadConstant(bytes), /Decimal local constant/);
  }
  const absent = new Writer().u8(17).compressed(codedIndex('TypeDefOrRef', native.typeToken)).finish();
  assert.throws(() => loadConstant(absent), /exactly 13/);
});

test('unbound symbols retain unresolved decimal payloads', () => {
  const bytes = new Uint8Array(assembly);
  const view = new DataView(bytes.buffer);
  const optional = view.getUint32(0x3c, true) + 24;
  const directories = optional + (view.getUint16(optional, true) === 0x20b ? 112 : 96);
  bytes.fill(0, directories + 6 * 8, directories + 7 * 8);
  const symbols = loadSymbols(bytes, pdb, { allowUnbound: true });
  assert.equal(symbols.bound, false);
  assert.equal(symbols.constants.find((constant) => constant.name === 'Decimal').reason, 'type-metadata-required');
});

test('same-name nested types, different namespaces and TypeSpec handles are not treated as System.Decimal', () => {
  const heap = new TextEncoder().encode('\0Decimal\0System\0Other\0');
  const names = new Map([
    [1, 'Decimal'],
    [9, 'System'],
    [16, 'Other'],
  ]);
  for (const [token, row] of [
    [0x01000001, [3, 1, 9]],
    [0x02000001, [2, 1, 9]],
    [0x01000001, [0, 1, 16]],
    [0x1b000001, []],
  ]) {
    const constant = { decoded: false, reason: 'type-metadata-required', typeToken: token };
    const metadata = { row: () => row, streams: new Map([['#Strings', heap]]), string: (index) => names.get(index) };
    bindConstantTypes([constant], metadata);
    assert.equal(constant.decoded, false);
    assert.equal(constant.reason, 'type-metadata-required');
  }
});

function declaredDecimal({
  name = 'mscorlib',
  culture = '',
  reference = false,
  key = Buffer.from('00000000000000000400000000000000', 'hex'),
  flags = 1,
} = {}) {
  const names = new Map();
  const indices = new Map();
  let text = '';
  for (const value of ['', 'Decimal', 'System', name, culture]) {
    if (indices.has(value)) continue;
    indices.set(value, text.length);
    names.set(text.length, value);
    text += value + '\0';
  }
  const identity = reference
    ? [4, 0, 0, 0, flags, 1, indices.get(name), indices.get(culture), 0]
    : [0x8004, 4, 0, 0, 0, flags, 1, indices.get(name), indices.get(culture)];
  const typeToken = reference ? 0x01000001 : 0x02000001;
  const type = [reference ? 6 : 1, indices.get('Decimal'), indices.get('System')];
  const metadata = {
    counts: { 1: 1, 2: 1, 35: 1 },
    rows: { 32: reference ? [] : [identity] },
    row: (token) => (token === typeToken ? type : identity),
    blob: () => key,
    streams: new Map([['#Strings', new TextEncoder().encode(text)]]),
    string: (index) => names.get(index),
  };
  const constant = {
    typeToken,
    decoded: false,
    reason: 'type-metadata-required',
    signature: new Writer()
      .u8(17)
      .compressed(codedIndex('TypeDefOrRef', typeToken))
      .u8(1)
      .u32(15)
      .u32(0)
      .u32(0)
      .finish(),
  };
  return { metadata, constant };
}

test('known framework AssemblyRef tokens and own Assembly public keys establish declared identity', () => {
  const identities = [
    {},
    { reference: true, name: 'System.Runtime', flags: 0, key: Buffer.from('b03f5f7f11d50a3a', 'hex') },
    { reference: true, name: 'System.Private.CoreLib', flags: 0, key: Buffer.from('7cec85d7bea7798e', 'hex') },
  ];
  for (const identity of identities) {
    const { metadata, constant } = declaredDecimal(identity);
    bindConstantTypes([constant], metadata);
    assert.equal(constant.value, '1.5');
    assert.deepEqual(constant.decimal, { coefficient: 15n, scale: 1, negative: false });
  }
});

test('custom-assembly lookalikes, wrong keys, cultures and unsupported flags stay unresolved', () => {
  const identities = [
    { name: 'Custom' },
    { name: 'Custom', reference: true },
    { key: new Uint8Array(), flags: 0 },
    { culture: 'en-US' },
    { flags: 0x201 },
    { reference: true, name: 'System.Runtime', flags: 0, key: new Uint8Array(8) },
    { reference: true, name: 'System.Runtime', flags: 0, key: new Uint8Array() },
  ];
  for (const identity of identities) {
    const { metadata, constant } = declaredDecimal(identity);
    bindConstantTypes([constant], metadata);
    assert.equal(constant.decoded, false);
    assert.equal(constant.reason, 'type-metadata-required');
  }
});

test('framework public keys are bounded before hashing', () => {
  const { metadata, constant } = declaredDecimal({ key: new Uint8Array(16385) });
  assert.throws(() => bindConstantTypes([constant], metadata), /assembly key byte limit/);
});

test('aggregate assembly keys and scope count are bounded across distinct type references', () => {
  for (const [count, size, flags, error] of [
    [65, 16384, 1, /key byte limit/],
    [1025, 8, 0, /identity limit/],
  ]) {
    const { metadata } = declaredDecimal({ reference: true, name: 'System.Runtime', key: new Uint8Array(size), flags });
    const type = metadata.row(0x01000001);
    const identity = metadata.row(0x23000001);
    metadata.row = (token) => (token >>> 24 === 1 ? [(token & 0xffffff) * 4 + 2, type[1], type[2]] : identity);
    const constants = Array.from({ length: count }, (_, index) => ({ typeToken: 0x01000001 + index }));
    assert.throws(() => bindConstantTypes(constants, metadata), error);
  }
});

test('bound decimal values own their scalar representation after PE/PDB mutation', () => {
  const peBytes = new Uint8Array(assembly),
    pdbBytes = new Uint8Array(pdb);
  const symbols = loadSymbols(peBytes, pdbBytes);
  const value = symbols.constants.find((constant) => constant.name === 'Decimal');
  peBytes.fill(0);
  pdbBytes.fill(0);
  value.raw.fill(0);
  assert.equal(value.value, '-123.4500');
  assert.equal(value.decimal.coefficient, 1234500n);
  value.decimal.coefficient = 0n;
  assert.equal(
    loadSymbols(assembly, pdb).constants.find((constant) => constant.name === 'Decimal').decimal.coefficient,
    1234500n,
  );
});
