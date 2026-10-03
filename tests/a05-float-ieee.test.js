import test from 'node:test';
import assert from 'node:assert/strict';
import {float, floatBinary, floatCompare, finiteFloat, ieeeRemainder} from '@sharpforge/bytecode';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

for (const kind of ['r4', 'r8']) {
  test(`T01.5 ${kind} arithmetic preserves signed zero and unordered comparisons`, () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.throws(() => finiteFloat(float(value, kind)), {name: 'ArithmeticException'});
    }
    const zero = float(-0, kind);
    assert.equal(finiteFloat(zero), zero);
    assert(Object.is(floatBinary('rem', zero, float(2, kind)).value, -0));
    for (const operation of ['eq', 'ne', 'lt', 'le', 'gt', 'ge']) {
      for (const [left, right] of [[NaN, 1], [1, NaN], [NaN, NaN]]) {
        assert.equal(floatCompare(float(left, kind), float(right, kind), operation), operation === 'ne');
        assert.equal(floatCompare(float(left, kind), float(right, kind), operation, true), true);
      }
    }
  });
}

test('T01.5 CLI remainder and IEEE nearest-even remainder have different quotient rules', () => {
  for (const [left, right, expected] of [[3, 2, -1], [5, 2, 1], [-3, 2, 1], [3, -2, -1]]) {
    assert.equal(ieeeRemainder(left, right), expected);
  }
  assert.equal(floatBinary('rem', float(3), float(2)).value, 1);
  assert(Object.is(ieeeRemainder(-4, 2), -0));
  assert.equal(ieeeRemainder(3, Infinity), 3);
  assert(Number.isNaN(ieeeRemainder(Infinity, 3)));
  assert(Number.isNaN(ieeeRemainder(3, 0)));
});

test('T01.5 source and both CIL routes expose the same raw IEEE observations', () => {
  const source = 'float x=16777216F;Console.WriteLine(BitConverter.SingleToInt32Bits(x+1F));' +
    'double left=3D;double right=2D;Console.WriteLine(left%right);' +
    'Console.WriteLine(Math.IEEERemainder(left,right));' +
    'Console.WriteLine(BitConverter.DoubleToInt64Bits(Math.IEEERemainder(-4D,right)));';
  const compiled = compileToIL(source);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  for (const vm of [new VirtualMachine(compiled.image), new VirtualMachine(loadAssembly(compiled.assembly)),
    new CilVirtualMachine(compiled.assembly)]) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, '1266679808\n1\n-1\n-9223372036854775808\n');
  }
});
