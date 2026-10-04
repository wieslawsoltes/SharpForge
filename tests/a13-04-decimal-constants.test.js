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

test('a top-level TypeDef declaration uses the same exact decimal format', () => {
  const heap = new TextEncoder().encode('\0Decimal\0System\0');
  const metadata = {
    counts: { 2: 1 },
    row: () => [1, 1, 9],
    streams: new Map([['#Strings', heap]]),
    string: (index) => (index === 1 ? 'Decimal' : 'System'),
  };
  const constant = {
    typeToken: 0x02000001,
    signature: new Writer().u8(17).compressed(4).u8(1).u32(15).u32(0).u32(0).finish(),
  };
  bindConstantTypes([constant], metadata);
  assert.equal(constant.value, '1.5');
  assert.deepEqual(constant.decimal, { coefficient: 15n, scale: 1, negative: false });
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
