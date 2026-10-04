import test from 'node:test';
import assert from 'node:assert/strict';
import {convert, float, nativeInteger, nativeSize, number} from '@sharpforge/bytecode';
import {binary, compare, defaults, indirect, storage, unary} from '../packages/runtime/src/execution/numeric-ops.js';

for (const nativeIntBits of [32, 64]) {
  const context = {nativeIntBits}, wrap = value => nativeInteger(value, nativeIntBits);
  const signedMinimum = -(1n << BigInt(nativeIntBits - 1));
  const signedMaximum = -signedMinimum - 1n, unsignedMaximum = (1n << BigInt(nativeIntBits)) - 1n;

  test(`native${nativeIntBits}: conversions retain category, exact bounds and unsigned source width`, () => {
    assert.equal(nativeSize(context), nativeIntBits / 8);
    assert.deepEqual(convert('conv.i', 4294967297n, context), wrap(4294967297n));
    assert.deepEqual(convert('conv.i', -1, context), wrap(-1));
    assert.deepEqual(convert('conv.u', -1, context), wrap(4294967295n));
    for (const [target, minimum, maximum] of [['i', signedMinimum, signedMaximum], ['u', 0n, unsignedMaximum]]) {
      for (const value of [minimum, maximum]) assert.deepEqual(convert('conv.ovf.' + target, value, context), wrap(value));
      for (const value of [minimum - 1n, maximum + 1n]) {
        assert.throws(() => convert('conv.ovf.' + target, value, context), {name: 'OverflowException'});
      }
      assert.deepEqual(convert('conv.ovf.' + target + '.un', maximum, context), wrap(maximum));
    }
    assert.deepEqual(convert('conv.ovf.u.un', -1, context), wrap(4294967295n));
    assert.throws(() => convert('conv.ovf.u', -1, context), {name: 'OverflowException'});
    assert.deepEqual(convert('conv.u', float(-1), context), wrap(0));
    assert.deepEqual(convert('conv.i', float(Infinity), context), wrap(signedMaximum));
    assert.deepEqual(convert('conv.u', float(Infinity), context), wrap(unsignedMaximum));
    assert.deepEqual(convert('conv.i', float(NaN), context), wrap(0));
    assert.throws(() => convert('conv.ovf.i', float(Infinity), context), {name: 'OverflowException'});
    assert.equal(number(convert('conv.r.un', wrap(-1), context)), Number(unsignedMaximum));
    assert.equal(convert('conv.i8', wrap(-1), context), -1n);
    assert.equal(convert('conv.u8', wrap(-1), context), nativeIntBits === 64 ? -1n : 4294967295n);
    assert(Object.isFrozen(convert('conv.i', 1, context)));
  });

  test(`native${nativeIntBits}: mixed arithmetic, unsigned widening, shifts and faults`, () => {
    assert.deepEqual(binary('add', wrap(7), -2, context), wrap(5));
    assert.deepEqual(binary('add', -2, wrap(7), context), wrap(5));
    assert.deepEqual(binary('add', wrap(signedMaximum), 1, context), wrap(signedMinimum));
    assert.deepEqual(binary('add.ovf.un', wrap(0), -1, context), wrap(4294967295n));
    assert.deepEqual(binary('div.un', wrap(-1), 2, context), wrap(unsignedMaximum / 2n));
    assert.deepEqual(binary('rem', wrap(-7), 3, context), wrap(-1));
    assert.deepEqual(binary('shl', wrap(1), nativeIntBits + 1, context), wrap(2));
    assert.deepEqual(binary('shr.un', wrap(-1), wrap(1), context), wrap(signedMaximum));
    assert.equal(binary('shl', 1, wrap(33), context), 2);
    assert.equal(binary('shl', 1n, wrap(65), context), 2n);
    assert.deepEqual(unary('neg', wrap(signedMinimum), context), wrap(signedMinimum));
    assert.deepEqual(unary('not', wrap(0), context), wrap(-1));
    assert.throws(() => binary('add.ovf', wrap(signedMaximum), 1, context), {name: 'OverflowException'});
    assert.throws(() => binary('add.ovf.un', wrap(-1), 1, context), {name: 'OverflowException'});
    for (const opcode of ['div', 'rem']) {
      assert.throws(() => binary(opcode, wrap(signedMinimum), -1, context), {name: 'OverflowException'});
      assert.throws(() => binary(opcode, wrap(1), 0, context), {name: 'DivideByZeroException'});
    }
    assert(compare(wrap(-1), 0, 'lt', false, context));
    assert(compare(wrap(-1), 0, 'gt', true, context));
    assert(compare(wrap(-1), -1, 'eq', false, context));
    assert(compare(wrap(-1), -1, 'eq', true, context));
    assert.equal(compare(wrap(-1), -1, 'ne', true, context, true), nativeIntBits === 64);
  });

  test(`native${nativeIntBits}: declared storage and indirect operations preserve the ABI`, () => {
    for (const type of ['nint', 'nuint', 'System.IntPtr', 'System.UIntPtr']) {
      assert.deepEqual(defaults(type, context), wrap(0));
      assert.deepEqual(storage(4294967297n, type, context), wrap(4294967297n));
      assert.deepEqual(storage(wrap(-1), type), wrap(-1));
    }
    assert.deepEqual(indirect(4294967297n, 'stind.i', context), wrap(4294967297n));
    assert.deepEqual(indirect(wrap(-1), 'ldind.i', context), wrap(-1));
    assert.equal(storage(wrap(-1), 'uint', context), -1);
    for (const value of [1n, float(1), nativeInteger(1, nativeIntBits === 64 ? 32 : 64)]) {
      assert.throws(() => binary('add', wrap(1), value, context), {name: 'InvalidProgramException'});
      assert.throws(() => compare(wrap(1), value, 'eq', false, context), {name: 'InvalidProgramException'});
    }
  });
}

test('native ABI defaults explicitly to 32 and rejects unsupported widths', () => {
  assert.equal(nativeSize(), 4);
  assert.deepEqual(convert('conv.i', 4294967297n), nativeInteger(1, 32));
  for (const nativeIntBits of [0, 16, 128, '64']) {
    assert.throws(() => nativeSize({nativeIntBits}), /nativeIntBits must be 32 or 64/);
  }
  const fault = new Error('injected overflow');
  assert.throws(() => convert('conv.ovf.i', 2147483648n, {fault: () => fault}), error => error === fault);
});

test('native storage retains opaque managed method pointers without inventing an address', () => {
  const pointer = Object.freeze({methodPointer: true, token: 0x06000001});
  assert.equal(storage(pointer, 'nint', {nativeIntBits: 64}), pointer);
  assert.equal(indirect(pointer, 'ldind.i', {nativeIntBits: 64}), pointer);
  assert.throws(() => binary('add', pointer, 1), {name: 'InvalidProgramException'});
});
