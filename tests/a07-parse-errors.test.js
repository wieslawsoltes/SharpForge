import test from 'node:test';
import assert from 'node:assert/strict';
import {intrinsicDefinition} from '@sharpforge/cil';
import {execute} from './fixtures/a07/legacy-builtin-engines.js';

// .NET 10 reference contracts, not a native CLR qualification claim:
// https://learn.microsoft.com/en-us/dotnet/api/system.convert.toint32?view=net-10.0#system-convert-toint32(system-string)
// https://learn.microsoft.com/en-us/dotnet/api/system.int32.parse?view=net-10.0#system-int32-parse(system-string)
const stringCases = [
  [null, {value: 0}, {fault: 'ArgumentNullException'}],
  ['', {fault: 'FormatException'}],
  [' \t\r\n', {fault: 'FormatException'}],
  ['abc', {fault: 'FormatException'}],
  ['0', {value: 0}],
  ['-0', {value: 0}],
  [' +42 ', {value: 42}],
  ['\t-18\r\n', {value: -18}],
  ['000137', {value: 137}],
  ['2147483647', {value: 2147483647}],
  ['-2147483648', {value: -2147483648}],
  ['2147483648', {fault: 'OverflowException'}],
  ['-2147483649', {fault: 'OverflowException'}],
  ['999999999999999999999999999999999999999', {fault: 'OverflowException'}],
  ['+', {fault: 'FormatException'}],
  ['- 1', {fault: 'FormatException'}],
  ['++1', {fault: 'FormatException'}],
  ['1 2', {fault: 'FormatException'}],
  ['1.0', {fault: 'FormatException'}],
  ['-6.00', {fault: 'FormatException'}],
  ['1e2', {fault: 'FormatException'}],
  ['0x10', {fault: 'FormatException'}],
  ['0b10', {fault: 'FormatException'}],
  ['1,000', {fault: 'FormatException'}],
  ['NaN', {fault: 'FormatException'}],
  ['Infinity', {fault: 'FormatException'}],
  ['１２', {fault: 'FormatException'}]
];

for (const name of ['Convert.ToInt32', 'int.Parse']) {
  for (const [input, converted, parsed = converted] of stringCases) {
    const expected = name === 'int.Parse' ? parsed : converted;
    const fixture = {name, args: [input], result: 'int', parameter: 'string'};
    for (const engine of ['source', 'cil']) {
      test(`SF-A07-B04 ${engine} ${name}(${JSON.stringify(input)})`, () => {
        assert.deepEqual(execute(fixture, engine), expected);
      });
    }
  }
}

const numericCases = [
  [true, 'bool', {value: 1}],
  [false, 'bool', {value: 0}],
  [42, 'int', {value: 42}],
  [2.5, 'double', {value: 2}],
  [3.5, 'double', {value: 4}],
  [-2.5, 'double', {value: -2}],
  [-3.5, 'double', {value: -4}],
  [2147483647.25, 'double', {value: 2147483647}],
  [2147483647.5, 'double', {fault: 'OverflowException'}],
  [-2147483648.5, 'double', {value: -2147483648}],
  [-2147483648.75, 'double', {fault: 'OverflowException'}],
  [NaN, 'double', {fault: 'OverflowException'}],
  [Infinity, 'double', {fault: 'OverflowException'}],
  [-Infinity, 'double', {fault: 'OverflowException'}]
];

for (const [input, parameter, expected] of numericCases) {
  for (const engine of ['source', 'cil']) {
    test(`SF-A07-B04 ${engine} retains Convert.ToInt32(${parameter} ${String(input)})`, () => {
      const fixture = {name: 'Convert.ToInt32', args: [input], result: 'int', parameter};
      assert.deepEqual(execute(fixture, engine), expected);
    });
  }
}

test('SF-A07-B04 direct CIL uses the actual parse and conversion intrinsics', () => {
  for (const [owner, name, implementation] of [
    ['System.Int32', 'Parse', 'parse'],
    ['System.Convert', 'ToInt32', 'convertInt32']
  ]) {
    const definition = intrinsicDefinition({
      kind: 'method', owner, name,
      signature: {parameters: ['string'], returnType: 'int', isStatic: true, genericArity: 0, callingConvention: 0}
    });
    assert.equal(definition.contract, null);
    assert.equal(definition.implementation, implementation);
  }
});
