import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Writer, codedIndex, readPE } from '@sharpforge/cil';
import { loadSymbols, readPortablePdb, emitPortablePdb, attachPortablePdb } from '@sharpforge/symbols';
import { bindConstantTypes } from '../packages/symbols/src/constant-binding.js';
import { constantTypeSpecs } from '../packages/symbols/src/nullable-constant.js';

const directory = new URL('./fixtures/portable-pdb-nullable-constants/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8'));
const assembly = new Uint8Array(readFileSync(new URL('NullableDefaults.dll', directory)));
const pdb = new Uint8Array(readFileSync(new URL('NullableDefaults.pdb', directory)));
const method = 0x06000001;
const native = reference.native.constants.find((constant) => constant.name === 'Int32');
const signature = (kind = 17) =>
  new Writer().u8(kind).compressed(codedIndex('TypeDefOrRef', native.typeToken)).finish();
function loadConstant(bytes) {
  const symbols = emitPortablePdb(assembly, {
    methods: [{ token: method, constants: [{ name: 'Default', signature: bytes }] }],
  }).bytes;
  return loadSymbols(attachPortablePdb(assembly, symbols), symbols).constants[0];
}

test('SRM-built Nullable TypeSpecs bind sixteen CLR boxed defaults without claiming C# const generation', () => {
  assert.equal(reference.native.origin, 'SRM MetadataBuilder; not C# const declarations');
  const symbols = loadSymbols(assembly, pdb);
  const standalone = readPortablePdb(pdb);
  const metadata = readPE(assembly, { inspection: true }).metadata;
  assert.equal(reference.native.constants.length, 16);
  for (const constant of reference.native.constants) {
    assert.equal(constant.boxedDefaultIsNull, true);
    assert.match(constant.typeSignature, /^System\.Nullable`1</);
    const result = symbols.constants.find((item) => item.name === constant.name);
    assert.equal(result.type, 'nullable');
    assert.equal(result.value, null);
    assert.equal(result.decoded, true);
    assert.equal(result.reason, null);
    assert.equal(result.defaultValue, true);
    assert.equal(result.typeToken, constant.typeToken);
    assert.equal(Buffer.from(result.signature).toString('hex').toUpperCase(), constant.signature);
    assert.equal(
      Buffer.from(metadata.blob(metadata.row(constant.typeToken)[0]))
        .toString('hex')
        .toUpperCase(),
      constant.typeSpec,
    );
    assert.equal(standalone.constants.find((item) => item.name === constant.name).reason, 'type-metadata-required');
    assert.equal(
      symbols.scopes[0].constants.find((item) => item.name === constant.name),
      result,
    );
  }
});

test('nullable defaults preserve modifiers and reject class markers without guessing present payloads', () => {
  const prefix = new Writer().u8(32).compressed(codedIndex('TypeDefOrRef', 0x01000002)).finish();
  const modified = loadConstant(new Uint8Array([...prefix, ...signature()]));
  assert.equal(modified.value, null);
  assert.deepEqual(modified.customModifiers, [{ required: false, typeToken: 0x01000002 }]);
  assert.throws(() => loadConstant(signature(18)), /Nullable local constant requires a value-type/);
  const present = loadConstant(new Uint8Array([...signature(), 1]));
  assert.equal(present.decoded, false);
  assert.equal(present.defaultValue, false);
  assert.equal(present.reason, 'type-metadata-required');
});

function fixtureWithTypeSpec(
  bytes,
  { name = 'Nullable`1', framework = 'System.Runtime', key = 'b03f5f7f11d50a3a' } = {},
) {
  const names = new Map(),
    offsets = new Map();
  let text = '';
  for (const value of ['', name, 'System', framework, 'Decimal']) {
    if (offsets.has(value)) continue;
    offsets.set(value, text.length);
    names.set(text.length, value);
    text += value + '\0';
  }
  const metadata = {
    counts: { 1: 2, 27: 1, 35: 1 },
    row: (token) =>
      token >>> 24 === 27
        ? [1]
        : token >>> 24 === 35
          ? [10, 0, 0, 0, 0, 2, offsets.get(framework), 0, 0]
          : [6, offsets.get(token === 0x01000001 ? name : 'Decimal'), offsets.get('System')],
    blob: (index) => (index === 1 ? bytes : Buffer.from(key, 'hex')),
    streams: new Map([['#Strings', new TextEncoder().encode(text)]]),
    string: (index) => names.get(index),
  };
  const constant = {
    typeToken: 0x1b000001,
    type: 'signature',
    decoded: false,
    defaultValue: true,
    reason: 'type-metadata-required',
    signature: new Uint8Array([17, 6]),
  };
  bindConstantTypes([constant], metadata);
  return constant;
}

test('open, constructed, reference and modified arguments remain unresolved; lookalikes never bind', () => {
  for (const bytes of [
    [0x13, 0], // generic parameter TypeSpec
    [0x15, 0x11, 5, 1, 0x13, 0], // Nullable<!0>
    [0x15, 0x11, 5, 1, 14], // reference argument
    [0x15, 0x11, 5, 1, 0x1d, 8], // array argument
    [0x15, 0x11, 5, 1, 0x20, 9, 8], // modified argument
    [0x15, 0x11, 5, 2, 8, 8], // unsupported arity
    [0x15, 0x12, 5, 1, 8], // class generic base
  ])
    assert.equal(fixtureWithTypeSpec(new Uint8Array(bytes)).decoded, false);
  for (const identity of [{ name: 'Other`1' }, { framework: 'Custom' }, { key: '0000000000000000' }]) {
    assert.equal(fixtureWithTypeSpec(new Uint8Array([0x15, 0x11, 5, 1, 8]), identity).decoded, false);
  }
  assert.equal(fixtureWithTypeSpec(new Uint8Array([0x15, 0x11, 5, 1, 8])).decoded, true);
});

test('malformed TypeSpecs reject truncated, trailing and over-budget signatures', () => {
  for (const bytes of [[], [0x15], [0x15, 0x11, 5, 1], [0x15, 0x11, 5, 1, 8, 0], Array(34).fill(0x1d).concat(8)]) {
    assert.throws(() => fixtureWithTypeSpec(new Uint8Array(bytes)));
  }
});

test('TypeSpec aggregate preflight limits precede expansion and deduplicate repeated references', () => {
  let reads = 0;
  const metadata = {
    row: () => [1],
    blob: () => {
      reads++;
      return new Uint8Array(4096);
    },
  };
  const repeated = Array.from({ length: 2048 }, () => ({ typeToken: 0x1b000001 }));
  assert.equal(constantTypeSpecs(repeated, metadata).size, 1);
  assert.equal(reads, 1);
  for (const [count, length, error] of [
    [1, 4097, /byte limit/],
    [257, 4096, /byte limit/],
    [1025, 1, /count limit/],
  ]) {
    const constants = Array.from({ length: count }, (_, index) => ({ typeToken: 0x1b000001 + index }));
    metadata.blob = () => new Uint8Array(length);
    assert.throws(() => bindConstantTypes(constants, metadata), error);
  }
});

test('nullable results retain owned raw bytes and remain stable after input mutation', () => {
  const peBytes = new Uint8Array(assembly),
    pdbBytes = new Uint8Array(pdb);
  const symbols = loadSymbols(peBytes, pdbBytes);
  peBytes.fill(0);
  pdbBytes.fill(0);
  const result = symbols.constants[0];
  const original = new Uint8Array(result.signature);
  result.raw.fill(0);
  assert.equal(result.value, null);
  assert.equal(result.defaultValue, true);
  assert.deepEqual(loadSymbols(assembly, pdb).constants[0].signature, original);
});
