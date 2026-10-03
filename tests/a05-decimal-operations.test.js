import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decimal, decimalZero, decimalMaxCoefficient, decimalParse, decimalFormat, decimalBits, decimalFromBits,
  decimalBinary, decimalRound, decimalFromInteger, decimalToInteger, decimalFromFloat, decimalToFloat
} from '@sharpforge/bytecode';

const parse = decimalParse;
test('Decimal arithmetic preserves exact scale without binary floating arithmetic', () => {
  assert.equal(decimalFormat(decimalBinary('+', parse('0.1'), parse('0.2'))), '0.3');
  assert.equal(decimalFormat(decimalBinary('/', parse('1'), parse('3'))), '0.3333333333333333333333333333');
  assert.equal(decimalFormat(decimalBinary('*', parse('1.10'), parse('2.0'))), '2.200');
  assert.equal(decimalFormat(decimalBinary('%', parse('-7.5'), parse('2'))), '-1.5');
  assert.equal(decimalBinary('==', parse('1.00'), parse('1')), true);
  assert.equal(decimalFormat(decimalBinary('-', parse('4.00'), parse('1.1'))), '2.90');
});
test('Decimal rounding separates banker arithmetic from text midpoint formatting', () => {
  assert.equal(decimalFormat(decimalRound(parse('2.5'))), '2');
  assert.equal(decimalFormat(decimalRound(parse('3.5'))), '4');
  assert.equal(decimalFormat(decimalRound(parse('-2.5'), 0, 1)), '-3');
  assert.equal(decimalFormat(decimalRound(parse('-2.1'), 0, 3)), '-3');
  assert.equal(decimalFormat(parse('2.5'), 'F0'), '3');
  assert.equal(decimalFormat(parse('1.10')), '1.10');
});
test('Decimal representation keeps signed zero and validates reserved flags', () => {
  const zero = decimal(0n, 28, true);
  assert.deepEqual(decimalFromBits(decimalBits(zero)), zero);
  assert.ok(Object.isFrozen(zero));
  assert.ok(Object.is(decimalToFloat(zero), -0));
  assert.throws(() => decimalFromBits([0, 0, 0, 1]), {name: 'ArgumentException'});
  assert.throws(() => decimalFromBits([0, 0, 0, 29 << 16]), {name: 'ArgumentException'});
});
test('Decimal conversion truncates integers, checks overflow and interprets unsigned stack bits', () => {
  assert.equal(decimalToInteger(parse('-12.99'), {bits: 32}), -12);
  assert.equal(decimalFormat(decimalFromInteger(-1n, true, 64)), '18446744073709551615');
  assert.equal(decimalFormat(decimalFromFloat(0.1)), '0.1');
  assert.throws(() => decimalFromFloat(Infinity), {name: 'OverflowException'});
  assert.throws(() => decimalToInteger(parse('2147483648'), {bits: 32}), {name: 'OverflowException'});
  assert.throws(() => decimalToInteger(parse('-1'), {bits: 64, unsigned: true}), {name: 'OverflowException'});
});
test('Decimal arithmetic faults retain caller-provided managed fault adapters', () => {
  const context = {fault: (name, message) => Object.assign(new Error(message), {name, managed: true})};
  assert.throws(() => decimalBinary('+', decimal(decimalMaxCoefficient), parse('1'), context),
    error => error.name === 'OverflowException' && error.managed);
  for (const operation of ['/', '%']) assert.throws(() => decimalBinary(operation, parse('1'), decimalZero, context),
    error => error.name === 'DivideByZeroException' && error.managed);
  assert.throws(() => decimalRound(parse('1'), 29), {name: 'ArgumentOutOfRangeException'});
  assert.throws(() => decimalParse('bad'), {name: 'FormatException'});
  assert.throws(() => decimalParse('1'.repeat(4097)), {name: 'FormatException'});
});
