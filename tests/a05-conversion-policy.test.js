import test from 'node:test';
import assert from 'node:assert/strict';
import {conversionTargets, convert, float, nativeInteger, number} from '@sharpforge/bytecode';

const sources = [0, -1, 2147483647, -2147483648, 0n, -1n, (1n << 63n) - 1n,
  float(NaN), float(Infinity), float(-Infinity), float(2 ** 31), float(2 ** 63), float(2 ** 64)];

test('T01.6 every ECMA conversion target has explicit immutable policy metadata', () => {
  assert.equal(conversionTargets.length, 13);
  assert(Object.isFrozen(conversionTargets));
  for (const target of conversionTargets) {
    assert(Object.isFrozen(target));
    for (const value of sources) {
      const converted = convert('conv.' + target.name, value);
      assert(['number', 'bigint'].includes(typeof number(converted)), target.name);
    }
  }
});

for (const nativeIntBits of [32, 64]) test(`T01.6 native source/target saturation and .un at ABI${nativeIntBits}`, () => {
  const context = {nativeIntBits};
  const maximum = (1n << BigInt(nativeIntBits - 1)) - 1n;
  assert.equal(BigInt(number(convert('conv.i', float(Infinity), context))), maximum);
  assert.equal(BigInt(number(convert('conv.u', float(NaN), context))), 0n);
  assert.equal(number(convert('conv.ovf.u8.un', nativeInteger(-1, nativeIntBits), context)),
    nativeIntBits === 64 ? -1n : 4294967295n);
  assert.throws(() => convert('conv.ovf.i', float(Infinity), context), {name: 'OverflowException'});
});

test('T01.6 invalid opcode combinations never silently select another conversion', () => {
  for (const name of ['conv.r', 'conv.ovf.r4', 'conv.ovf.r8.un', 'conv.u4.un', 'conv.i3']) {
    assert.throws(() => convert(name, 1), {name: 'CilError'});
  }
  assert.equal(convert('conv.u8', -1), 4294967295n);
  assert.equal(convert('conv.u8', float(-1)), 0n);
});
