import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Writer, codedIndex } from '@sharpforge/cil';
import { loadSymbols, readPortablePdb, emitPortablePdb, attachPortablePdb } from '@sharpforge/symbols';
import { bindConstantTypes } from '../packages/symbols/src/constant-binding.js';

const directory = new URL('./fixtures/portable-pdb-datetime-constants/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8'));
const assembly = new Uint8Array(readFileSync(new URL('DateTimeConstants.dll', directory)));
const pdb = new Uint8Array(readFileSync(new URL('DateTimeConstants.pdb', directory)));
const native = fixture.native.constants[0];
const standalone = readPortablePdb(pdb);
const method = standalone.scopes.find((scope) =>
  scope.constants.some((constant) => constant.name === native.name),
).methodToken;
const signature = (ticks, kind = 17) =>
  new Writer().u8(kind).compressed(codedIndex('TypeDefOrRef', native.typeToken)).i64(ticks).finish();
function loadConstant(bytes) {
  const symbols = emitPortablePdb(assembly, {
    methods: [{ token: method, constants: [{ name: 'When', signature: bytes }] }],
  }).bytes;
  return loadSymbols(attachPortablePdb(assembly, symbols), symbols).constants[0];
}

test('bound DateTime literals match VB/SRM ticks and unspecified kind', () => {
  const symbols = loadSymbols(assembly, pdb);
  assert.equal(fixture.native.constants.length, 4);
  for (const reference of fixture.native.constants) {
    const result = symbols.constants.find((constant) => constant.name === reference.name);
    assert.equal(reference.typeName, 'System.DateTime');
    assert.equal(reference.kind, 'Unspecified');
    assert.equal(result.type, 'datetime');
    assert.equal(result.decoded, true);
    assert.equal(result.reason, null);
    assert.equal(result.value, BigInt(reference.ticks));
    assert.deepEqual(result.dateTime, { ticks: BigInt(reference.ticks), kind: 'unspecified' });
    assert.equal(Buffer.from(result.signature).toString('hex').toUpperCase(), reference.signature);
    assert.equal(
      symbols.scopes
        .find((scope) => scope.methodToken === method)
        .constants.find((constant) => constant.name === reference.name),
      result,
    );
    assert.equal(
      standalone.constants.find((constant) => constant.name === reference.name).reason,
      'type-metadata-required',
    );
  }
});

test('DateTime ticks preserve minimum, full native maximum and a single 100ns unit', () => {
  for (const ticks of [BigInt(fixture.native.limits.minimum), 1n, BigInt(fixture.native.limits.maximum)]) {
    const result = loadConstant(signature(ticks));
    assert.equal(result.value, ticks);
    assert.equal(typeof result.value, 'bigint');
    assert.deepEqual(result.dateTime, { ticks, kind: 'unspecified' });
  }
  assert.equal(fixture.native.limits.singleTick, '0001-01-01T00:00:00.0000001');
});

test('DateTime payloads reject native out-of-range ticks, wrong length and class markers', () => {
  for (const reference of fixture.native.rejected) {
    assert.equal(reference.error, 'ArgumentOutOfRangeException');
    assert.throws(() => loadConstant(signature(BigInt(reference.ticks))), /DateTime local constant ticks/);
  }
  for (const ticks of [-(1n << 63n), (1n << 63n) - 1n]) {
    assert.throws(() => loadConstant(signature(ticks)), /DateTime local constant ticks/);
  }
  const valid = signature(0n);
  for (const bytes of [
    valid.subarray(0, valid.length - 1),
    new Uint8Array([...valid, 0]),
    valid.subarray(0, valid.length - 8),
  ]) {
    assert.throws(() => loadConstant(bytes), /DateTime local constant requires exactly 8/);
  }
  assert.throws(() => loadConstant(signature(0n, 18)), /DateTime local constant requires a value-type/);
});

test('DateTime custom modifiers and owned scalars survive input mutation', () => {
  const prefix = new Writer().u8(31).compressed(codedIndex('TypeDefOrRef', native.typeToken)).finish();
  const result = loadConstant(new Uint8Array([...prefix, ...signature(1n)]));
  assert.deepEqual(result.customModifiers, [{ required: true, typeToken: native.typeToken }]);
  result.raw.fill(0);
  result.signature.fill(0);
  assert.equal(result.value, 1n);
  assert.equal(result.dateTime.ticks, 1n);
  result.dateTime.ticks = 0n;
  assert.equal(loadConstant(signature(1n)).dateTime.ticks, 1n);
  const peBytes = new Uint8Array(assembly),
    pdbBytes = new Uint8Array(pdb);
  const symbols = loadSymbols(peBytes, pdbBytes);
  peBytes.fill(0);
  pdbBytes.fill(0);
  assert.equal(symbols.constants.find((constant) => constant.name === native.name).value, BigInt(native.ticks));
});

test('explicitly unbound DateTime stays unresolved', () => {
  const bytes = new Uint8Array(assembly);
  const view = new DataView(bytes.buffer);
  const optional = view.getUint32(0x3c, true) + 24;
  const directories = optional + (view.getUint16(optional, true) === 0x20b ? 112 : 96);
  bytes.fill(0, directories + 6 * 8, directories + 7 * 8);
  const symbols = loadSymbols(bytes, pdb, { allowUnbound: true });
  assert.equal(symbols.bound, false);
  assert.equal(symbols.constants.find((constant) => constant.name === native.name).reason, 'type-metadata-required');
});

function declaredType({
  name = 'System.Runtime',
  namespace = 'System',
  key = 'b03f5f7f11d50a3a',
  scope = 6,
  token = 0x01000001,
} = {}) {
  const names = new Map(),
    indices = new Map();
  let text = '';
  for (const value of ['', 'DateTime', namespace, name]) {
    if (indices.has(value)) continue;
    indices.set(value, text.length);
    names.set(text.length, value);
    text += value + '\0';
  }
  const metadata = {
    counts: { 1: 1, 27: 1, 35: 1 },
    row: (handle) =>
      handle === token
        ? [scope, indices.get('DateTime'), indices.get(namespace)]
        : [4, 0, 0, 0, 0, 1, indices.get(name), 0, 0],
    blob: () => (token >>> 24 === 27 ? new Uint8Array([0x13, 0]) : Buffer.from(key, 'hex')),
    streams: new Map([['#Strings', new TextEncoder().encode(text)]]),
    string: (index) => names.get(index),
  };
  const constant = {
    typeToken: token,
    decoded: false,
    reason: 'type-metadata-required',
    signature: new Writer().u8(17).compressed(codedIndex('TypeDefOrRef', token)).i64(1n).finish(),
  };
  return { metadata, constant };
}

test('DateTime uses the shared declared-framework identity gate and does not decode lookalikes', () => {
  for (const identity of [
    {},
    { name: 'mscorlib', key: 'b77a5c561934e089' },
    { name: 'System.Private.CoreLib', key: '7cec85d7bea7798e' },
  ]) {
    const { metadata, constant } = declaredType(identity);
    bindConstantTypes([constant], metadata);
    assert.equal(constant.value, 1n);
  }
  for (const identity of [
    { name: 'Custom' },
    { key: '0000000000000000' },
    { namespace: 'Other' },
    { scope: 3 },
    { token: 0x1b000001 },
  ]) {
    const { metadata, constant } = declaredType(identity);
    bindConstantTypes([constant], metadata);
    assert.equal(constant.decoded, false);
    assert.equal(constant.reason, 'type-metadata-required');
  }
});
