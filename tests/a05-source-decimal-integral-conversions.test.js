import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {BuiltinMap, decimalIntrinsicDefinitions} from '@sharpforge/bytecode';
import {decodeDecimalBuiltin} from '../packages/cil/src/builtin-emission.js';

const conversions = [
  ['ToSByte', 'sbyte', 'value', '-128', '127', 'System.SByte'],
  ['ToByte', 'byte', 'value', '0', '255', 'System.Byte'],
  ['ToInt16', 'short', 'value', '-32768', '32767', 'System.Int16'],
  ['ToUInt16', 'ushort', 'value', '0', '65535', 'System.UInt16'],
  ['ToInt32', 'int', 'd', '-2147483648', '2147483647', 'System.Int32'],
  ['ToUInt32', 'uint', 'd', '0', '4294967295', 'System.UInt32'],
  ['ToInt64', 'long', 'd', '-9223372036854775808', '9223372036854775807', 'System.Int64'],
  ['ToUInt64', 'ulong', 'd', '0', '18446744073709551615', 'System.UInt64']
];

function engines(body, members = '') {
  const compiled = compileToIL(`using System; using D = System.Decimal;
    class Program { static void Main() { ${body} } ${members} }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reloaded source', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['direct CIL', () => new CilVirtualMachine(compiled.assembly)]
  ];
}

function assertOutput(body, expected, members = '') {
  for (const [engine, create] of engines(body, members)) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, expected, engine);
  }
}

test('integral conversion entries append their exact result widths and real parameter names', () => {
  const previous = BuiltinMap.get('decimal.Abs#1').id;
  for (const [index, [name, type, parameter]] of conversions.entries()) {
    const entry = BuiltinMap.get(`decimal.${name}#1`);
    assert.equal(entry.id, previous + index + 1);
    assert(decimalIntrinsicDefinitions.includes(entry.decimal));
    assert.deepEqual(entry.params, ['decimal']);
    assert.deepEqual(entry.parameterNames, [parameter]);
    assert.equal(entry.result, type);
    assert.equal(entry.decimal.returnType, type);
    assert(Object.isFrozen(entry));
  }
});

for (const [name, type, parameter, minimum, maximum] of conversions) {
  test(`${name} truncates before checking ${type} bounds in either checked context`, () => {
    const lowerFraction = minimum === '0' ? '-0.9' : minimum + '.9';
    const body = ['checked', 'unchecked'].map(mode => `${mode} {
      ${type} low = D.${name}(${parameter}: ${lowerFraction}m);
      ${type} high = System.Decimal.${name}(${parameter}: ${maximum}.9m);
      Console.WriteLine(low); Console.WriteLine(high);
      Console.WriteLine(decimal.${name}(-0.999999m)); Console.WriteLine(decimal.${name}(0.999999m));
      Console.WriteLine(decimal.${name}(decimal.Parse("-0.0000")));
    }`).join('\n');
    assertOutput(body, `${minimum}\n${maximum}\n0\n0\n0\n`.repeat(2));
  });

  test(`${name} preserves OverflowException at both bounds even in unchecked code`, () => {
    for (const value of [BigInt(minimum) - 1n, BigInt(maximum) + 1n]) {
      for (const mode of ['checked', 'unchecked']) {
        const body = `decimal input = ${value}m; ${mode} { Console.WriteLine(decimal.${name}(input)); }`;
        for (const [engine, create] of engines(body)) {
          const result = create().run();
          assert.equal(result.state, 'faulted', `${engine}: ${name}(${value}), ${mode}`);
          assert.equal(result.fault.name, 'OverflowException', engine);
          assert.equal(result.output, '', engine);
        }
      }
    }
  });
}

test('conversion results retain declared widths through arrays, boxes, formatting and Decimal widening', () => {
  const body = conversions.map(([name, type, , , maximum]) => `{
    ${type}[] values = new ${type}[] { decimal.${name}(${maximum}.9m) };
    object boxed = values[0]; values[0] = 0;
    Console.WriteLine(boxed); Console.WriteLine(boxed.GetType().FullName);
    Console.WriteLine((decimal)D.${name}(${maximum}.9m));
    Console.WriteLine(D.${name}(${maximum}.9m) > 0);
  }`).join('\n');
  const expected = conversions.map(([, , , , maximum, runtimeType]) => `${maximum}\n${runtimeType}\n${maximum}\nTrue\n`).join('');
  assertOutput(body, expected);
});

test('named conversion arguments evaluate once and integral arguments use ordinary Decimal widening', () => {
  const body = conversions.map(([name, , parameter]) =>
    `Console.WriteLine(D.${name}(${parameter}: Read())); Console.WriteLine(decimal.${name}(7));`).join('\n');
  assertOutput(body, 'R12\n7\n'.repeat(conversions.length),
    'static decimal Read() { Console.Write("R"); return 12.9m; }');
});

test('integral conversion registration rejects unsupported arguments and mismatched CLI results', () => {
  for (const [name, type, parameter] of conversions) {
    const wrongParameter = parameter === 'd' ? 'value' : 'd';
    for (const argumentsText of ['', '1.25', 'null', '1m, 2', `${wrongParameter}: 1m`]) {
      const expression = `decimal.${name}(${argumentsText})`;
      const compiled = compileToIL(`using System; class P { static void Main() { Console.WriteLine(${expression}); } }`);
      assert.equal(compiled.success, false, expression);
      assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'), expression);
    }
    const target = {owner: 'System.Decimal', name,
      sig: {kind: 'method', isStatic: true, returnType: type, parameters: ['System.Decimal']}};
    assert.equal(decodeDecimalBuiltin(target), BuiltinMap.get(`decimal.${name}#1`));
    for (const replacement of [{returnType: 'System.Decimal'}, {returnType: type === 'int' ? 'uint' : 'int'},
      {isStatic: false}, {parameters: ['double']}, {parameters: ['System.Decimal&']},
      {parameters: []}, {genericArity: 1}, {callingConvention: 5}]) {
      assert.equal(decodeDecimalBuiltin({...target, sig: {...target.sig, ...replacement}}), null, name);
    }
  }
  const invalidResult = compileToIL('using System; class P { static void Main() { byte value = decimal.ToInt32(1m); } }');
  assert.equal(invalidResult.success, false);
  assert(invalidResult.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
});
