import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {BuiltinMap, decimalBits, decimalIntrinsicDefinitions} from '@sharpforge/bytecode';
import {decodeDecimalBuiltin} from '../packages/cil/src/builtin-emission.js';

function assertOutput(body, expected, members = '', inspect) {
  const compiled = compileToIL(`using System; using D = System.Decimal;
    class Program { static void Main() { ${body} } ${members} }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const engines = [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reloaded source', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['direct CIL', () => new CilVirtualMachine(compiled.assembly)]
  ];
  for (const [engine, create] of engines) {
    const vm = create(), result = vm.run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, expected, engine);
    inspect?.(vm, engine);
  }
}

test('Negate and Abs append exact Decimal descriptors with their distinct parameter names', () => {
  const previous = BuiltinMap.get('decimal.Equals#2').id;
  for (const [index, [name, parameter]] of [['Negate', 'd'], ['Abs', 'value']].entries()) {
    const entry = BuiltinMap.get(`decimal.${name}#1`);
    assert.equal(entry.id, previous + index + 1);
    assert(decimalIntrinsicDefinitions.includes(entry.decimal));
    assert.deepEqual(entry.params, ['decimal']);
    assert.deepEqual(entry.parameterNames, [parameter]);
    assert.equal(entry.result, 'decimal');
    assert.equal(entry.decimal.returnType, 'System.Decimal');
    assert(Object.isFrozen(entry));
  }
});

test('sign methods preserve scale and the complete Decimal range on every engine', () => {
  const cases = [
    ['1.2300m', '-1.2300', '1.2300'], ['-1.2300m', '1.2300', '1.2300'],
    ['0.0000m', '0.0000', '0.0000'], ['decimal.Parse("-0.0000")', '0.0000', '0.0000'],
    ['0.0000000000000000000000000001m', '-0.0000000000000000000000000001', '0.0000000000000000000000000001'],
    ['-0.0000000000000000000000000001m', '0.0000000000000000000000000001', '0.0000000000000000000000000001'],
    ['7922816251426433759354395033.5m', '-7922816251426433759354395033.5', '7922816251426433759354395033.5'],
    ['decimal.MaxValue', '-79228162514264337593543950335', '79228162514264337593543950335'],
    ['decimal.MinValue', '79228162514264337593543950335', '79228162514264337593543950335']
  ];
  const body = cases.map(([value]) => `{
    decimal original = ${value};
    Console.WriteLine(decimal.Negate(original)); Console.WriteLine(D.Abs(original));
    Console.WriteLine(decimal.Negate(original) == -original);
  }`).join('\n');
  const expected = cases.map(([, negate, absolute]) => `${negate}\n${absolute}\nTrue\n`).join('');
  assertOutput(body, expected);
});

test('sign methods preserve zero sign through the existing Decimal to Double conversion', () => {
  assertOutput(`Original = decimal.Parse("-0.0000");
    PositiveResult = decimal.Negate(0.0000m); NegativeResult = decimal.Negate(Original);
    AbsoluteResult = decimal.Abs(Original);
    Console.WriteLine(1.0 / (double)PositiveResult); Console.WriteLine(1.0 / (double)NegativeResult);
    Console.WriteLine(1.0 / (double)AbsoluteResult); Console.WriteLine(1.0 / (double)Original);`,
  '-Infinity\nInfinity\nInfinity\n-Infinity\n',
  'static decimal Original; static decimal PositiveResult; static decimal NegativeResult; static decimal AbsoluteResult;',
  (vm, engine) => {
    for (const [name, flags] of [['Original', -2147221504], ['PositiveResult', -2147221504],
      ['NegativeResult', 262144], ['AbsoluteResult', 262144]]) {
      const slot = vm.inspector
        ? [...vm.inspector.fields.values()].find(field => field.name === name)?.token
        : vm.image.statics.findIndex(field => field.name === 'Program.' + name);
      assert(slot !== undefined && slot !== -1, `${engine}: missing ${name}`);
      const value = vm.inspector ? vm.statics.get(slot) : vm.statics[slot];
      assert.deepEqual(decimalBits(value), [0, 0, 0, flags], `${engine}: ${name}`);
      assert(Object.isFrozen(value), `${engine}: ${name}`);
    }
  });
});

test('named arguments evaluate once and sign results retain value storage and integral widening', () => {
  assertOutput(`decimal[] values = new decimal[] { System.Decimal.Negate(d: Read()), D.Abs(value: Read()) };
    object negated = values[0]; object absolute = values[1];
    values[0] = 0m; values[1] = 0m;
    Console.WriteLine(negated); Console.WriteLine(absolute);
    Console.WriteLine(decimal.Negate(7)); Console.WriteLine(decimal.Abs(long.MinValue));
    checked { Console.WriteLine(decimal.Negate(decimal.MinValue)); }`,
  'RR1.2300\n1.2300\n-7\n9223372036854775808\n79228162514264337593543950335\n',
  'static decimal Read() { Console.Write("R"); return -1.2300m; }');
});

test('sign registration rejects incompatible parameters, names and reload signatures', () => {
  for (const name of ['Negate', 'Abs']) {
    for (const argumentsText of ['', '1.25', 'null', '1.25m, 2']) {
      const expression = `decimal.${name}(${argumentsText})`;
      const compiled = compileToIL(`using System; class P { static void Main() { Console.WriteLine(${expression}); } }`);
      assert.equal(compiled.success, false, expression);
      assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'), expression);
    }
    const target = {owner: 'System.Decimal', name,
      sig: {kind: 'method', isStatic: true, returnType: 'System.Decimal', parameters: ['System.Decimal']}};
    assert.equal(decodeDecimalBuiltin(target), BuiltinMap.get(`decimal.${name}#1`));
    for (const replacement of [{isStatic: false}, {returnType: 'double'}, {parameters: ['double']},
      {parameters: ['System.Decimal&']}, {parameters: []}, {genericArity: 1}, {callingConvention: 5}]) {
      assert.equal(decodeDecimalBuiltin({...target, sig: {...target.sig, ...replacement}}), null, name);
    }
    assert.equal(decodeDecimalBuiltin({...target, owner: 'System.Math'}), null);
  }
  for (const expression of ['decimal.Negate(value: 1m)', 'decimal.Abs(d: 1m)']) {
    const compiled = compileToIL(`using System; class P { static void Main() { Console.WriteLine(${expression}); } }`);
    assert.equal(compiled.success, false, expression);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'), expression);
  }
});
