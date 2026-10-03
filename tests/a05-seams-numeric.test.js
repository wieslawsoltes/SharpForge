import test from 'node:test';
import assert from 'node:assert/strict';
import {binary, compare, convert, defaults, float, indirect, isNumber, number, storage, unary} from '../packages/runtime/src/execution/numeric-ops.js';

const throwsFault = (action, name, message) => assert.throws(action, {name, ...(message ? {message} : {})});

test('CIL numeric seam: tagged floats retain precision, special values and immutable representation', () => {
  const single = float(16777217, 'r4');
  assert.deepEqual(single, {float: 'r4', value: 16777216});
  assert(Object.isFrozen(single));
  assert.deepEqual(float(16777217), {float: 'r8', value: 16777217});
  assert(Object.is(number(float(-0)), -0));
  assert.equal(number(float(Infinity)), Infinity);
  assert(Number.isNaN(number(float(NaN))));
  for (const value of [0, -42, NaN, Infinity, 9007199254740993n, single]) assert(isNumber(value));
  for (const value of [null, undefined, false, '1', {}, [], {h: 0, g: 1}]) {
    assert.equal(isNumber(value), false);
    assert.equal(number(value), value);
  }
});

test('CIL numeric seam: initialized locals receive the declared primitive defaults', () => {
  for (const type of ['int', 'uint', 'short', 'ushort', 'byte', 'sbyte', 'char', 'bool', 'nint', 'nuint']) assert.equal(number(defaults(type)), 0, type);
  for (const type of ['long', 'ulong']) assert.equal(defaults(type), 0n, type);
  assert.deepEqual(defaults('double'), float(0));
  assert.deepEqual(defaults('float'), float(0, 'r4'));
  for (const type of ['object', 'string', 'int[]', 'Example.Record']) assert.equal(defaults(type), null, type);
});

test('CIL numeric seam: Int32 operations wrap, truncate and mask shift counts', () => {
  for (const [op, a, b, expected] of [
    ['add', 2147483647, 1, -2147483648], ['sub', -2147483648, 1, 2147483647],
    ['mul', 2147483647, 2147483647, 1], ['div', -7, 3, -2], ['rem', -7, 3, -1],
    ['and', 10, 6, 2], ['or', 10, 6, 14], ['xor', 10, 6, 12],
    ['shl', 1, 33, 2], ['shl', 1, -1, -2147483648], ['shr', -8, 34, -2],
    ['shr.un', -1, 1, 2147483647], ['shr.un', -1, 32, -1],
    ['div.un', -1, 2, 2147483647], ['rem.un', -1, 2, 1],
  ]) assert.equal(binary(op, a, b), expected, `${op} ${a} ${b}`);
});

test('CIL numeric seam: Int64 operations preserve exact integers and stack bit patterns', () => {
  for (const [op, a, b, expected] of [
    ['add', 9007199254740993n, 11n, 9007199254741004n],
    ['add', 9223372036854775807n, 1n, -9223372036854775808n],
    ['sub', -9223372036854775808n, 1n, 9223372036854775807n],
    ['mul', 4294967296n, 4294967296n, 0n], ['div', -7n, 3n, -2n], ['rem', -7n, 3n, -1n],
    ['and', 10n, 6n, 2n], ['or', 10n, 6n, 14n], ['xor', 10n, 6n, 12n],
    ['shl', 1n, 65, 2n], ['shl', 1n, -1, -9223372036854775808n], ['shr', -8n, 66, -2n],
    ['shr.un', -1n, 1, 9223372036854775807n], ['div.un', -1n, 2n, 9223372036854775807n], ['rem.un', -1n, 2n, 1n],
  ]) assert.equal(binary(op, a, b), expected, `${op} ${a} ${b}`);
});

test('CIL numeric seam: checked signed and unsigned arithmetic accepts endpoints and rejects overflow', () => {
  for (const [op, a, b, expected] of [
    ['add.ovf', 2147483646, 1, 2147483647], ['sub.ovf', -2147483647, 1, -2147483648],
    ['mul.ovf', -1073741824, 2, -2147483648], ['add.ovf.un', -2, 1, -1], ['sub.ovf.un', -1, -1, 0],
    ['add.ovf', 9223372036854775806n, 1n, 9223372036854775807n],
    ['mul.ovf', -4611686018427387904n, 2n, -9223372036854775808n], ['add.ovf.un', -2n, 1n, -1n],
  ]) assert.equal(binary(op, a, b), expected);
  for (const [op, a, b] of [
    ['add.ovf', 2147483647, 1], ['sub.ovf', -2147483648, 1], ['mul.ovf', 1073741824, 2],
    ['add.ovf.un', -1, 1], ['sub.ovf.un', 0, 1], ['mul.ovf.un', -1, 2],
    ['add.ovf', 9223372036854775807n, 1n], ['sub.ovf', -9223372036854775808n, 1n],
    ['mul.ovf', 4611686018427387904n, 2n], ['add.ovf.un', -1n, 1n], ['sub.ovf.un', 0n, 1n], ['mul.ovf.un', -1n, 2n],
  ]) throwsFault(() => binary(op, a, b), 'OverflowException', 'Checked arithmetic overflow');
});

test('CIL numeric seam: integer division faults and invalid operands remain explicit', () => {
  for (const op of ['div', 'rem', 'div.un', 'rem.un']) {
    throwsFault(() => binary(op, 1, 0), 'DivideByZeroException');
    throwsFault(() => binary(op, 1n, 0n), 'DivideByZeroException');
  }
  throwsFault(() => binary('div', -2147483648, -1), 'OverflowException', 'Integer division overflow');
  throwsFault(() => binary('div', -9223372036854775808n, -1n), 'OverflowException', 'Integer division overflow');
  for (const value of [null, false, '3', {h: 0, g: 1}]) throwsFault(() => binary('add', value, 1), 'InvalidProgramException');
  throwsFault(() => binary('add', 1, 1n), 'InvalidProgramException', 'Mismatched integer widths');
  throwsFault(() => binary('add', 1n, 1), 'InvalidProgramException', 'Mismatched integer widths');
  throwsFault(() => binary('unknown', 1, 2), 'CilError', 'Unknown arithmetic opcode');
});

test('CIL numeric seam: floating arithmetic retains IEEE values and rejects integer-only opcodes', () => {
  const left = float(7.5), right = float(2, 'r4');
  for (const [op, expected] of [['add', 9.5], ['sub', 5.5], ['mul', 15], ['div', 3.75], ['rem', 1.5]]) assert.deepEqual(binary(op, left, right), float(expected));
  assert.equal(number(binary('div', float(1), float(0))), Infinity);
  assert(Number.isNaN(number(binary('div', float(0), float(0)))));
  assert(Object.is(number(binary('mul', float(-0), float(2))), -0));
  for (const op of ['and', 'shl', 'add.ovf', 'add.ovf.un', 'div.un']) throwsFault(() => binary(op, left, right), 'InvalidProgramException', 'Invalid floating-point operation');
  assert.deepEqual(left, float(7.5));
  assert.deepEqual(right, float(2, 'r4'));
});

test('CIL numeric seam: unary operations keep integer widths and floating signed zero', () => {
  assert.equal(unary('neg', -2147483648), -2147483648);
  assert.equal(unary('neg', -9223372036854775808n), -9223372036854775808n);
  assert.equal(unary('neg', 42), -42);
  assert.equal(unary('not', 0), -1);
  assert.equal(unary('not', 0n), -1n);
  assert.equal(unary('not', -1n), 0n);
  assert(Object.is(number(unary('neg', float(0))), -0));
  throwsFault(() => unary('neg', null), 'InvalidProgramException', 'Numeric operand required');
  throwsFault(() => unary('not', float(1)), 'CilError', 'not requires integer');
});

test('CIL numeric seam: signed and unsigned comparisons respect Int32 and Int64 boundaries', () => {
  for (const [op, expected] of [['eq', false], ['ne', true], ['gt', false], ['ge', false], ['lt', true], ['le', true]]) assert.equal(compare(-1, 1, op), expected, op);
  for (const value of [-1, -1n]) {
    const zero = typeof value === 'bigint' ? 0n : 0;
    assert.equal(compare(value, zero, 'gt', true), true);
    assert.equal(compare(value, zero, 'lt', true), false);
    assert.equal(compare(value, value, 'eq'), true);
    assert.equal(compare(value, value, 'ge'), true);
    assert.equal(compare(value, value, 'le'), true);
  }
  assert.equal(compare(9007199254740993n, 9007199254740992n, 'gt'), true);
  assert.equal(compare(float(-0), float(0), 'eq'), true);
  for (const value of [undefined, '1', false, {}]) throwsFault(() => compare(value, 1, 'eq'), 'InvalidProgramException', 'Numeric comparison expected');
});

test('CIL numeric seam: unordered floating comparisons and reference identity use CIL rules', () => {
  for (const [a, b] of [[float(NaN), float(0)], [float(0), float(NaN)]]) {
    assert.equal(compare(a, b, 'eq'), false);
    assert.equal(compare(a, b, 'ne'), true);
    for (const op of ['gt', 'ge', 'lt', 'le']) {
      assert.equal(compare(a, b, op), false);
      assert.equal(compare(a, b, op, true), true);
    }
  }
  const ref = Object.freeze({h: 2, g: 4});
  assert.equal(compare(ref, {h: 2, g: 4}, 'eq'), true);
  assert.equal(compare(ref, {h: 2, g: 5}, 'eq'), false);
  assert.equal(compare(ref, {h: 3, g: 4}, 'ne'), true);
  assert.equal(compare(null, null, 'eq'), true);
  assert.equal(compare(ref, null, 'gt', true), true);
  assert.equal(compare(null, null, 'gt', true), false);
  throwsFault(() => compare(ref, null, 'gt'), 'InvalidProgramException', 'Invalid reference comparison');
  throwsFault(() => compare(ref, ref, 'lt', true), 'InvalidProgramException', 'Invalid reference comparison');
});

test('CIL numeric seam: conversions truncate and preserve signed stack representations', () => {
  for (const [target, input, expected] of [
    ['i1', 255, -1], ['u1', -1, 255], ['i2', 65535, -1], ['u2', -1, 65535],
    ['i4', 4294967295n, -1], ['u4', -1, -1], ['i', 4294967295n, -1], ['u', -1, -1],
    ['i8', 18446744073709551615n, -1n], ['u8', -1n, -1n],
    ['i4', float(-3.9), -3], ['i8', float(3.9), 3n],
  ]) {
    const actual = convert('conv.' + target, input);
    if (target === 'i' || target === 'u') assert.deepEqual(actual, {nativeInt: 32, value: expected}, target);
    else assert.equal(actual, expected, target);
  }
  assert.deepEqual(convert('conv.r4', 16777217), float(16777216, 'r4'));
  assert.deepEqual(convert('conv.r8', 16777217), float(16777217));
  assert.deepEqual(convert('conv.r.un', -1), float(4294967295));
  assert.deepEqual(convert('conv.r.un', -1n), float(Number(18446744073709551615n)));
  assert.equal(convert('conv.ovf.i8.un', -1), 4294967295n);
  throwsFault(() => convert('conv.i4', null), 'InvalidProgramException', 'Numeric conversion required');
  throwsFault(() => convert('conv.invalid', 1), 'CilError', 'Invalid conversion');
});

test('CIL numeric seam: checked conversions cover every signed and unsigned target boundary', () => {
  for (const [target, min, max, expectedMin, expectedMax] of [
    ['i1', -128n, 127n, -128, 127], ['u1', 0n, 255n, 0, 255],
    ['i2', -32768n, 32767n, -32768, 32767], ['u2', 0n, 65535n, 0, 65535],
    ['i4', -2147483648n, 2147483647n, -2147483648, 2147483647], ['u4', 0n, 4294967295n, 0, -1],
    ['i8', -9223372036854775808n, 9223372036854775807n, -9223372036854775808n, 9223372036854775807n],
    ['u8', 0n, 18446744073709551615n, 0n, -1n],
    ['i', -2147483648n, 2147483647n, -2147483648, 2147483647], ['u', 0n, 4294967295n, 0, -1],
  ]) {
    if (target === 'i' || target === 'u') {
      assert.deepEqual(convert('conv.ovf.' + target, min), {nativeInt: 32, value: expectedMin}, target);
      assert.deepEqual(convert('conv.ovf.' + target, max), {nativeInt: 32, value: expectedMax}, target);
    } else {
      assert.equal(convert('conv.ovf.' + target, min), expectedMin, target);
      assert.equal(convert('conv.ovf.' + target, max), expectedMax, target);
    }
    for (const input of [min - 1n, max + 1n]) throwsFault(() => convert('conv.ovf.' + target, input), 'OverflowException', 'Checked conversion overflow');
  }
  throwsFault(() => convert('conv.ovf.i4.un', -1), 'OverflowException');
  throwsFault(() => convert('conv.ovf.i8.un', -1n), 'OverflowException');
  assert.equal(convert('conv.ovf.u8.un', -1n), -1n);
});

test('CIL numeric seam: non-finite and out-of-range float conversions follow the .NET 10 profile', () => {
  for (const [raw, int32, int64] of [[NaN, 0, 0n], [Infinity, 2147483647, 9223372036854775807n], [-Infinity, -2147483648, -9223372036854775808n]]) {
    assert.equal(convert('conv.i4', float(raw)), int32);
    assert.equal(convert('conv.i8', float(raw)), int64);
    throwsFault(() => convert('conv.ovf.i4', float(raw)), 'OverflowException', 'Non-finite integer conversion');
  }
  assert.equal(convert('conv.i4', float(2147483648)), 2147483647);
  assert.equal(convert('conv.i4', float(-2147483649)), -2147483648);
  assert.equal(convert('conv.i4', float(2147483647)), 2147483647);
  assert.equal(convert('conv.i4', float(-2147483648)), -2147483648);
});

test('CIL numeric seam: storage narrows declared primitive aliases without changing references', () => {
  for (const [alias, fullName, input, expected] of [
    ['sbyte', 'System.SByte', 255, -1], ['byte', 'System.Byte', 511, 255],
    ['short', 'System.Int16', 65535, -1], ['ushort', 'System.UInt16', 131071, 65535],
    ['char', 'System.Char', -1, 65535], ['bool', 'System.Boolean', 258, 2],
    ['int', 'System.Int32', 4294967295n, -1], ['uint', 'System.UInt32', -1, -1],
    ['long', 'System.Int64', 18446744073709551615n, -1n], ['ulong', 'System.UInt64', -1n, -1n],
    ['float', 'System.Single', 16777217, float(16777216, 'r4')], ['double', 'System.Double', 16777217, float(16777217)],
  ]) {
    assert.deepEqual(storage(input, alias), expected, alias);
    assert.deepEqual(storage(input, fullName), expected, fullName);
  }
  const ref = Object.freeze({h: 1, g: 1});
  assert.equal(storage(ref, 'object'), ref);
  assert.equal(storage(null, 'string'), null);
  throwsFault(() => storage(ref, 'System.Int32'), 'InvalidProgramException');
});

test('CIL numeric seam: indirect opcode suffixes narrow loads and stores', () => {
  for (const prefix of ['ldind', 'stind', 'ldelem', 'stelem']) {
    for (const [suffix, input, expected] of [['i1', 255, -1], ['u1', -1, 255], ['i2', 65535, -1], ['u2', -1, 65535], ['i4', 4294967295n, -1], ['u4', -1, -1], ['i8', -1, -1n], ['i', 4294967295n, {nativeInt: 32, value: -1}], ['r4', 16777217, float(16777216, 'r4')], ['r8', 16777217, float(16777217)]]) assert.deepEqual(indirect(input, prefix + '.' + suffix), expected);
  }
  const ref = Object.freeze({h: 1, g: 1});
  assert.equal(indirect(ref, 'ldind.ref'), ref);
  assert.equal(indirect(null, 'stelem.ref'), null);
  throwsFault(() => indirect(ref, 'ldind.i4'), 'InvalidProgramException');
});

test('CIL numeric seam: injected factories preserve host error identity through every operation', () => {
  const calls = [], sentinel = new Error('host-owned error');
  const context = {
    fault(type, message) { calls.push([type, message]); return sentinel; },
    error(message) { calls.push(['CilError', message]); return sentinel; },
  };
  for (const action of [
    () => binary('div', 1, 0, context), () => compare('x', 1, 'eq', false, context),
    () => convert('conv.ovf.i1', 128, context), () => storage(null, 'int', context),
    () => indirect(null, 'ldind.i4', context), () => unary('neg', null, context),
    () => binary('unknown', 1, 2, context), () => convert('conv.invalid', 1, context),
    () => unary('not', float(1), context),
  ]) assert.throws(action, error => error === sentinel);
  assert.deepEqual(calls.map(([name]) => name), ['DivideByZeroException', 'InvalidProgramException', 'OverflowException', 'InvalidProgramException', 'InvalidProgramException', 'InvalidProgramException', 'CilError', 'CilError', 'CilError']);
  const opaque = Object.freeze({opaque: true});
  assert.equal(compare(opaque, null, 'gt', true, {isReference: value => !!value?.opaque}), true);
});
