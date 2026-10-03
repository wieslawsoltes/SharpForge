import test from 'node:test';
import assert from 'node:assert/strict';
import {int64Binary, int64Compare, int64Unary, binary} from '@sharpforge/bytecode';

const minimum = -(1n << 63n);
const maximum = (1n << 63n) - 1n;

test('T01.1 Int64 wrapping, unsigned division and mixed shift counts share the CIL dispatcher', () => {
  const cases = [
    ['add', maximum, 1n, minimum], ['sub', minimum, 1n, maximum],
    ['mul', maximum, maximum, 1n], ['div.un', -1n, 3n, 6148914691236517205n],
    ['rem', minimum, -1n, 0n], ['shr.un', -1n, 65, maximum],
    ['shl', 1n, -1, minimum], ['shl', 7n, 128n, 7n],
  ];
  for (const [name, left, right, expected] of cases) {
    assert.equal(int64Binary(name, left, right), expected);
    assert.equal(binary(name, left, right), expected);
  }
  assert.equal(int64Unary('neg', minimum), minimum);
  assert.equal(int64Compare(-1n, 0n), -1);
  assert.equal(int64Compare(-1n, 0n, true), 1);
});

test('T01.1 Int64 checked boundaries and arithmetic faults remain managed faults', () => {
  for (const [name, left, right] of [
    ['add.ovf', maximum, 1n], ['sub.ovf', minimum, 1n], ['mul.ovf', maximum, 2n],
    ['add.ovf.un', -1n, 1n], ['sub.ovf.un', 0n, 1n], ['mul.ovf.un', -1n, 2n],
    ['div', minimum, -1n],
  ]) assert.throws(() => int64Binary(name, left, right), {name: 'OverflowException'});
  for (const name of ['div', 'div.un', 'rem', 'rem.un']) {
    assert.throws(() => int64Binary(name, 1n, 0n), {name: 'DivideByZeroException'});
  }
  assert.throws(() => int64Binary('add', 1n, 1), {name: 'InvalidProgramException'});
});
