import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCoded, metadataCodedIndices, token, decodeSignature, decodeTypeSignature } from '@sharpforge/cil';

const invalid = error => error.name === 'CilError';

test('coded indices preserve nil, valid tags and the maximum 24-bit row across every layout', () => {
  for (const [kind, [bits, tables]] of Object.entries(metadataCodedIndices)) {
    assert.equal(decodeCoded(kind, 0), 0, kind);
    for (let tag = 0; tag < 2 ** bits; tag++) {
      const table = tables[tag];
      if (table === undefined || table === null) {
        assert.throws(() => decodeCoded(kind, 2 ** bits + tag), invalid, kind);
        continue;
      }
      for (const row of [1, 0xffff, 0x10000, 0xffffff]) {
        assert.equal(decodeCoded(kind, row * 2 ** bits + tag), token(table, row), kind);
      }
    }
  }
});

test('physical coded indices reject malformed values and overflow before token composition', () => {
  for (const [kind, [bits, tables]] of Object.entries(metadataCodedIndices)) {
    const tag = tables.findIndex(table => table !== null && table !== undefined);
    for (const row of [0x1000000, 0x1000002]) {
      assert.throws(() => decodeCoded(kind, row * 2 ** bits + tag), invalid, kind);
    }
  }
  for (const value of [-1, 0.5, NaN, Infinity, 2 ** 32, '1', null, undefined, false]) {
    assert.throws(() => decodeCoded('TypeDefOrRef', value), invalid);
  }
});

test('an oversized MemberRef TypeRef parent cannot alias a local TypeDef', () => {
  // The old decoder produced local TypeDef 0x02000002 by carrying the RID into the table byte.
  assert.throws(() => decodeCoded('MemberRefParent', 0x08000011), invalid);
});

test('signature TypeDefOrRef overflow cannot turn an unresolved reference into a local type', () => {
  const type = new Uint8Array([0x12, 0xc4, 0, 0, 9]);
  assert.throws(() => decodeTypeSignature(type), invalid);
  assert.throws(() => decodeSignature(new Uint8Array([6, ...type])), invalid);
  assert.throws(() => decodeSignature(new Uint8Array([0x20, 1, 1, ...type])), invalid);
});
