import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeInstructions, decodeInstructionGroups } from '@sharpforge/cil';

test('instruction budget errors retain legacy name/code/message and add only their structured limit kind', () => {
  for (const decode of [decodeInstructions, decodeInstructionGroups]) {
    assert.throws(() => decode(Uint8Array.of(0x2a), { maxInstructions: 0 }), error => {
      assert.equal(error.name, 'CilError');
      assert.equal(error.message, 'IL instruction limit exceeded');
      assert.equal(error.code, undefined);
      assert.equal(error.offset, undefined);
      assert.equal(error.limitKind, 'instruction-count');
      return true;
    });
  }
});

test('prefix budget tags distinguish exhaustion from invalid options, malformed operands and dangling chains', () => {
  assert.throws(() => decodeInstructionGroups(Uint8Array.of(0xfe, 0x13, 0x2a), { maxPrefixes: 0 }), error => {
    assert.equal(error.name, 'CilError');
    assert.equal(error.message, 'CIL prefix chain limit exceeded at 0x0');
    assert.equal(error.code, undefined);
    assert.equal(error.offset, 0);
    assert.equal(error.limitKind, 'prefix-count');
    return true;
  });
  for (const [code, options] of [[Uint8Array.of(0x2a), { maxPrefixes: -1 }],
    [Uint8Array.of(0xfe, 0x13), {}], [Uint8Array.of(0xfe, 0x12, 0, 0x2a), {}],
    [Uint8Array.of(0x45, 1, 0, 0, 0), {}]]) {
    assert.throws(() => decodeInstructionGroups(code, options), error => error.name === 'CilError' && error.limitKind === undefined);
  }
});
