import test from 'node:test';
import assert from 'node:assert/strict';
import {float, floatBinary, floatCompare, finiteFloat, ieeeRemainder} from '@sharpforge/bytecode';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {binary, unary} from '../packages/runtime/src/execution/numeric-ops.js';
import {managedFixture} from './managed-fixtures.js';

test('T01.5 Single operations round at each instruction while mixed widths retain Double', () => {
  const single = binary('add', float(16777216, 'r4'), float(1, 'r4'));
  assert.deepEqual(single, float(16777216, 'r4'));
  assert(Object.isFrozen(single));
  assert.deepEqual(binary('add', float(16777216, 'r4'), float(1)), float(16777217));
  assert.deepEqual(binary('mul', float(3.4028234663852886e38, 'r4'), float(2, 'r4')), float(Infinity, 'r4'));
  assert.deepEqual(unary('neg', float(1, 'r4')), float(-1, 'r4'));
});

for (const kind of ['r4', 'r8']) test(`T01.5 ${kind} preserves signed zero, NaN, infinity and unordered comparison`, () => {
  assert(Object.is(floatBinary('mul', float(-0, kind), float(1, kind)).value, -0));
  assert(Object.is(unary('neg', float(0, kind)).value, -0));
  assert.equal(floatBinary('div', float(1, kind), float(-0, kind)).value, -Infinity);
  const nan = floatBinary('div', float(0, kind), float(0, kind));
  assert(Number.isNaN(nan.value));
  for (const operation of ['eq', 'lt', 'le', 'gt', 'ge']) assert.equal(floatCompare(nan, float(1), operation), false);
  assert.equal(floatCompare(nan, float(1), 'gt', true), true);
  assert.equal(floatCompare(nan, float(1), 'ne'), true);
  const finite = float(-0, kind);
  assert.equal(finiteFloat(finite), finite);
  for (const value of [nan, float(Infinity, kind), float(-Infinity, kind)]) {
    assert.throws(() => finiteFloat(value), {name: 'ArithmeticException'});
  }
});

test('T01.5 CLR truncated remainder and nearest-even IEEE remainder stay distinct', () => {
  assert.equal(floatBinary('rem', float(7), float(2)).value, 1);
  assert.equal(ieeeRemainder(7, 2), -1);
  assert.equal(ieeeRemainder(5, 2), 1);
  assert.equal(ieeeRemainder(-7, 2), 1);
  assert(Object.is(ieeeRemainder(-4, 2), -0));
  assert.equal(ieeeRemainder(1, Infinity), 1);
  assert(Number.isNaN(ieeeRemainder(Infinity, 1)));
  assert(Number.isNaN(ieeeRemainder(1, 0)));
});

test('T01.5 invalid floating operations preserve managed failure contracts', () => {
  assert.throws(() => float(1, 'invalid'), TypeError);
  for (const opcode of ['and', 'add.ovf', 'div.un']) {
    assert.throws(() => binary(opcode, float(1), float(2)), {name: 'InvalidProgramException'});
  }
});

for (const [kind, expected] of [['r4', 0], ['r8', 1]]) test(`T01.5 direct CIL retains ${kind} arithmetic precision`, () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', body(writer) {
    writer.op('ldc.' + kind, 16777216).op('ldc.' + kind, 1).op('add');
    writer.op('ldc.' + kind, 16777216).op('sub').op('conv.i4').op('ret');
  }}]});
  const result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.returnValue, expected);
});

test('T01.5 direct CIL ckfinite faults preserve the arithmetic exception type', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', body(writer) {
    writer.op('ldc.r8', Infinity).op('ckfinite').op('conv.i4').op('ret');
  }}]});
  const result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'ArithmeticException');
});
