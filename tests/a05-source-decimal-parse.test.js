import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {BuiltinMap, decimalParse, decimalFormat, decimalBits, decimalIntrinsicDefinitions} from '@sharpforge/bytecode';
import {decodeDecimalBuiltin} from '../packages/cil/src/builtin-emission.js';

function stringLiteral(text) {
  return JSON.stringify(text).replace(/[\u0085\u00a0\u2028\u2029\ufeff]/g,
    character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

function engines(body) {
  const compiled = compileToIL(`using System; using D = System.Decimal;
    class Program { static void Main() { ${body} } }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reloaded source', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['direct CIL', () => new CilVirtualMachine(compiled.assembly)]
  ];
}

test('source Parse uses one appended exact profile descriptor and the real string parameter name', () => {
  const entry = BuiltinMap.get('decimal.Parse#1');
  assert.equal(entry.id, BuiltinMap.get('decimal.Round#2').id + 1);
  assert(decimalIntrinsicDefinitions.includes(entry.decimal));
  assert.deepEqual(entry.params, ['string']);
  assert.deepEqual(entry.parameterNames, ['s']);
  assert.equal(entry.result, 'decimal');
  assert(Object.isFrozen(entry));
});

const valid = [
  ['1.2300', '1.2300'], [' \t\r\n\v\f-12.30 \t\r\n', '-12.30'],
  ['1,234.50', '1234.50'], ['1,2,3.00', '123.00'], ['1,', '1'], ['123.00-', '-123.00'], ['123.00 +', '123.00'],
  ['.50', '0.50'], ['0.000', '0.000'], ['-0.00', '0.00'],
  ['79228162514264337593543950335', '79228162514264337593543950335'],
  ['-79228162514264337593543950335', '-79228162514264337593543950335'],
  ['0.' + '0'.repeat(28) + '5', '0.' + '0'.repeat(28)],
  ['0.' + '0'.repeat(27) + '15', '0.' + '0'.repeat(27) + '2'],
  ['12.30\0\0', '12.30'], ['12.30 \0', '12.30'], ['0'.repeat(4095) + '1', '1']
];

test('source/reload/CIL Parse retains invariant Number syntax, exact scale and Decimal rounding', () => {
  const body = valid.map(([text]) => `Console.WriteLine(decimal.Parse(${stringLiteral(text)}));`).join('\n');
  const expected = valid.map(([, text]) => text + '\n').join('');
  for (const [engine, create] of engines(body)) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, expected, engine);
  }
});

test('named Parse argument, string concatenation, Decimal storage and boxes retain the shared value', () => {
  const body = `string text = "12." + "3000"; decimal amount = D.Parse(s: text);
    decimal[] values = new decimal[] { amount }; object boxed = values[0];
    values[0] = 0m; Console.WriteLine(boxed); Console.WriteLine(System.Decimal.Parse("1.20") + amount);`;
  for (const [engine, create] of engines(body)) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, '12.3000\n13.5000\n', engine);
  }
});

const invalid = [
  [null, 'ArgumentNullException'], ['', 'FormatException'], ['1e2', 'FormatException'], ['$1', 'FormatException'],
  ['(1)', 'FormatException'], ['- 1', 'FormatException'], ['1.2.3', 'FormatException'], [',1', 'FormatException'],
  ['\u00a01', 'FormatException'], ['1\u00a0', 'FormatException'], ['1\u00a0-', 'FormatException'],
  ['\ufeff1', 'FormatException'], ['1\ufeff', 'FormatException'], ['1\u2028', 'FormatException'], ['1\u2029', 'FormatException'],
  ['1\0 ', 'FormatException'], ['1\0\n', 'FormatException'], ['1\0x', 'FormatException'], ['1\0.2', 'FormatException'],
  ['\0', 'FormatException'], ['0'.repeat(4097), 'FormatException'],
  ['79228162514264337593543950336', 'OverflowException'], ['-79228162514264337593543950336', 'OverflowException']
];

for (const [text, fault] of invalid) {
  const label = text?.length > 80 ? `${text.length}-character text` : JSON.stringify(text);
  test(`Parse rejects ${label} with ${fault} on each engine`, () => {
    for (const [engine, create] of engines(`Console.WriteLine(D.Parse(${stringLiteral(text)}));`)) {
      const result = create().run();
      assert.equal(result.state, 'faulted', engine);
      assert.equal(result.fault.name, fault, engine);
    }
  });
}

test('the shared parser retains its explicit exponent option and exact signed-zero payload', () => {
  assert.equal(decimalFormat(decimalParse('1e2')), '100');
  assert.throws(() => decimalParse('1e2', {allowExponent: false}), {name: 'FormatException'});
  assert.deepEqual(decimalBits(decimalParse('-0.00\0')), [0, 0, 0, -2147352576]);
  for (const text of ['1\0 ', '1\0\n', '\ufeff1', '1\u00a0', '1\u2028']) {
    assert.throws(() => decimalParse(text), {name: 'FormatException'}, JSON.stringify(text));
  }
});

test('source and reloader leave provider, styles, span and TryParse overloads outside this family', () => {
  for (const call of ['decimal.Parse("1", null)', 'decimal.Parse("1", 0)', 'decimal.Parse(1)',
    'decimal.Parse("1", 0, null)', 'decimal.TryParse("1", out decimal value)']) {
    const compiled = compileToIL(`using System; class P { static void Main() { Console.WriteLine(${call}); } }`);
    assert.equal(compiled.success, false, call);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'), call);
  }
  const target = {owner: 'System.Decimal', name: 'Parse',
    sig: {kind: 'method', isStatic: true, returnType: 'System.Decimal', parameters: ['string']}};
  assert.equal(decodeDecimalBuiltin(target), BuiltinMap.get('decimal.Parse#1'));
  for (const parameters of [['string', 'System.IFormatProvider'], ['string', 'System.Globalization.NumberStyles'],
    ['System.ReadOnlySpan`1<char>'], ['object']]) {
    assert.equal(decodeDecimalBuiltin({...target, sig: {...target.sig, parameters}}), null);
  }
});
