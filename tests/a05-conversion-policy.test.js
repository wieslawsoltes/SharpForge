import test from 'node:test';
import assert from 'node:assert/strict';
import {conversionTargets, convert, float, number} from '@sharpforge/bytecode';
import {convert as runtimeConvert} from '../packages/runtime/src/execution/numeric-ops.js';

const sources = [0, -1, 2147483647, -2147483648, 0n, -1n, (1n << 63n) - 1n,
  float(NaN), float(Infinity), float(-Infinity), float(2 ** 31), float(2 ** 63), float(2 ** 64)];

test('T01.6 conversion policy exposes immutable metadata for every valid target', () => {
  assert.deepEqual(conversionTargets.map(target => target.name),
    ['i1', 'u1', 'i2', 'u2', 'i4', 'u4', 'i8', 'u8', 'i', 'u', 'r4', 'r8', 'r.un']);
  assert(Object.isFrozen(conversionTargets));
  for (const target of conversionTargets) {
    assert(Object.isFrozen(target));
    for (const value of sources) {
      assert(['number', 'bigint'].includes(typeof number(convert('conv.' + target.name, value))), target.name);
    }
  }
  assert.equal(runtimeConvert, convert, 'The runtime consumes the public policy without a second evaluator');
});

test('T01.6 invalid opcode combinations do not silently select another conversion', () => {
  for (const name of ['conv.r', 'conv.ovf.r4', 'conv.ovf.r8.un', 'conv.u4.un', 'conv.i3', 'conv.i4.extra']) {
    assert.throws(() => convert(name, 1), {name: 'CilError'});
  }
  for (const value of [null, '1', {}, true]) {
    assert.throws(() => convert('conv.i4', value), {name: 'InvalidProgramException'});
  }
});

test('T01.6 explicit source tags preserve floating saturation and integer widening', () => {
  assert.equal(convert('conv.u8', -1), 4294967295n);
  assert.equal(convert('conv.u8', float(-1)), 0n);
  assert.equal(convert('conv.i8', float(Infinity)), 9223372036854775807n);
  assert.equal(convert('conv.u8', float(Infinity)), -1n);
  assert.equal(convert('conv.i1', float(Infinity)), -1);
  assert.equal(convert('conv.u2', float(-Infinity)), 0);
  assert.equal(convert('conv.i4', float(NaN)), 0);
  assert.throws(() => convert('conv.ovf.i8', float(Infinity)), {name: 'OverflowException'});
  assert.equal(convert('conv.ovf.u8.un', -1), 4294967295n);
  assert.throws(() => convert('conv.ovf.u8', -1), {name: 'OverflowException'});
});

test('T01.6 native aliases retain the current 32-bit profile and injectable errors', () => {
  assert.equal(convert('conv.i', float(Infinity)), 2147483647);
  assert.equal(convert('conv.u', float(Infinity)), -1);
  const diagnostic = new Error('host opcode diagnostic'), managed = new Error('managed overflow');
  assert.throws(() => convert('conv.r', 1, {error: () => diagnostic}), error => error === diagnostic);
  assert.throws(() => convert('conv.ovf.u1', 300, {fault: () => managed}), error => error === managed);
});
