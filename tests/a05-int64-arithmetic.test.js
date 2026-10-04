import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {int64Binary, int64Compare, int64Unary} from '@sharpforge/bytecode';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const minimum = -(1n << 63n);
const maximum = (1n << 63n) - 1n;
const native = JSON.parse(readFileSync(new URL('./fixtures/a05/int64-arithmetic/native-boundaries.json', import.meta.url), 'utf8'));
const comparisons = new Map([['ceq', 0], ['clt', -1], ['clt.un', -1], ['cgt', 1], ['cgt.un', 1]]);

test('Int64 API preserves exact arithmetic, wrapping and signed stack patterns', () => {
  const cases = [
    ['add', 9007199254740993n, 11n, 9007199254741004n],
    ['add', maximum, 1n, minimum],
    ['sub', minimum, 1n, maximum],
    ['mul', maximum, maximum, 1n],
    ['div', -17n, 3n, -5n],
    ['rem', -17n, 3n, -2n],
    ['div.un', -1n, 3n, 6148914691236517205n],
    ['rem.un', -1n, 2n, 1n],
    ['and', minimum, -1n, minimum],
    ['or', minimum, maximum, -1n],
    ['xor', minimum, -1n, maximum],
    ['add.ovf', maximum - 1n, 1n, maximum],
    ['sub.ovf', minimum + 1n, 1n, minimum],
    ['mul.ovf', minimum, 1n, minimum],
    ['add.ovf.un', -2n, 1n, -1n],
    ['sub.ovf.un', -1n, 1n, -2n],
    ['mul.ovf.un', maximum, 2n, -2n],
  ];
  for (const [opcode, left, right, expected] of cases) {
    assert.equal(int64Binary(opcode, left, right), expected, opcode);
  }
});

test('Int64 shifts mask counts to six bits and distinguish logical from arithmetic right shift', () => {
  for (const count of [0, 64, 128, 0n, 64n]) {
    assert.equal(int64Binary('shl', 7n, count), 7n);
  }
  for (const count of [-1, 63, 127, -1n]) {
    assert.equal(int64Binary('shl', 1n, count), minimum);
  }
  assert.equal(int64Binary('shr', -1n, 65), -1n);
  assert.equal(int64Binary('shr.un', -1n, 65), maximum);
});

test('Int64 checked operations reject signed and unsigned overflow before narrowing', () => {
  for (const [opcode, left, right] of [
    ['add.ovf', maximum, 1n], ['sub.ovf', minimum, 1n], ['mul.ovf', maximum, 2n],
    ['add.ovf.un', -1n, 1n], ['sub.ovf.un', 0n, 1n], ['mul.ovf.un', -1n, 2n],
    ['div', minimum, -1n], ['rem', minimum, -1n],
  ]) {
    assert.throws(() => int64Binary(opcode, left, right), {name: 'OverflowException'}, opcode);
  }
  for (const opcode of ['div', 'div.un', 'rem', 'rem.un']) {
    assert.throws(() => int64Binary(opcode, 1n, 0n), {
      name: 'DivideByZeroException', message: 'Attempted to divide by zero',
    });
  }
});

test('Int64 comparison and unary operations retain all 64 bits', () => {
  assert.equal(int64Compare(9007199254740993n, 9007199254740992n), 1);
  assert.equal(int64Compare(-1n, 0n), -1);
  assert.equal(int64Compare(-1n, 0n, true), 1);
  assert.equal(int64Compare(minimum, maximum), -1);
  assert.equal(int64Compare(minimum, maximum, true), 1);
  assert.equal(int64Compare(-1n, -1n, true), 0);
  assert.equal(int64Unary('neg', minimum), minimum);
  assert.equal(int64Unary('neg', 9007199254740993n), -9007199254740993n);
  assert.equal(int64Unary('not', minimum), maximum);
});

test('Int64 helpers reject mixed arithmetic widths and preserve injected error identity', () => {
  assert.throws(() => int64Binary('add', 1n, 1), {name: 'InvalidProgramException'});
  assert.throws(() => int64Binary('add', 1, 1n), {name: 'InvalidProgramException'});
  assert.throws(() => int64Unary('invalid', 1n), {name: 'InvalidProgramException'});
  const managed = new Error('managed fault');
  const fault = (name, message) => {
    assert.equal(name, 'OverflowException');
    assert.equal(message, 'Checked arithmetic overflow');
    return managed;
  };
  assert.throws(() => int64Binary('add.ovf', maximum, 1n, {fault}), error => error === managed);
  const invalid = new Error('invalid instruction');
  assert.throws(() => int64Binary('invalid', 1n, 1n, {error: () => invalid}), error => error === invalid);
});

function evaluateReferenceCase(entry) {
  const left = BigInt(entry.left);
  const right = BigInt(entry.right);
  if (comparisons.has(entry.opcode)) {
    const order = int64Compare(left, right, entry.opcode.endsWith('.un'));
    return order === comparisons.get(entry.opcode) ? 1 : 0;
  }
  return int64Binary(entry.opcode, left, right);
}

function referenceAssembly(entry) {
  const shift = entry.opcode === 'shl' || entry.opcode.startsWith('shr');
  return managedFixture({methods: [{
    name: 'Main', result: comparisons.has(entry.opcode) ? 'int' : 'long', maxStack: 2,
    body(writer) {
      writer.op('ldc.i8', BigInt(entry.left));
      if (shift) writer.op('ldc.i4', Number(BigInt.asIntN(32, BigInt(entry.right))));
      else writer.op('ldc.i8', BigInt(entry.right));
      writer.op(entry.opcode).op('ret');
    },
  }]});
}

for (const entry of native.cases) {
  test(`Int64 native boundary: ${entry.opcode} ${entry.left}, ${entry.right}`, () => {
    const result = new CilVirtualMachine(referenceAssembly(entry)).run();
    if (entry.expected.startsWith('!')) {
      const name = entry.expected.slice(1);
      assert.throws(() => evaluateReferenceCase(entry), {name});
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, name);
    } else {
      assert.equal(String(evaluateReferenceCase(entry)), entry.expected);
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(String(result.returnValue), entry.expected);
    }
  });
}

for (const [opcode, input, expected] of [['neg', minimum, minimum], ['not', minimum, maximum]]) {
  test(`Direct CIL Int64 ${opcode} preserves the high bit`, () => {
    const bytes = managedFixture({methods: [{
      name: 'Main', result: 'long', maxStack: 1,
      body: writer => writer.op('ldc.i8', input).op(opcode).op('ret'),
    }]});
    const result = new CilVirtualMachine(bytes).run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, expected);
  });
}
