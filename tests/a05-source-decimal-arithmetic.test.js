import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {BuiltinMap, decimalIntrinsicDefinitions} from '@sharpforge/bytecode';
import {decodeDecimalBuiltin} from '../packages/cil/src/builtin-emission.js';

const names = ['Add', 'Subtract', 'Multiply', 'Divide', 'Remainder'];

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

test('static Decimal arithmetic appends five entries backed by the existing exact contracts', () => {
  const previous = BuiltinMap.get('decimal.Floor#1').id;
  for (const [index, name] of names.entries()) {
    const entry = BuiltinMap.get(`decimal.${name}#2`);
    assert.equal(entry.id, previous + index + 1);
    assert(decimalIntrinsicDefinitions.includes(entry.decimal));
    assert.deepEqual(entry.params, ['decimal', 'decimal']);
    assert.deepEqual(entry.parameterNames, ['d1', 'd2']);
    assert.equal(entry.result, 'decimal');
    assert(Object.isFrozen(entry));
  }
});

for (const [name, operator, left, right, expected] of [
  ['Add', '+', '0.1m', '0.2m', '0.3'],
  ['Subtract', '-', '1.10m', '0.2m', '0.90'],
  ['Multiply', '*', '1.10m', '2.0m', '2.200'],
  ['Divide', '/', '1m', '3m', '0.3333333333333333333333333333'],
  ['Remainder', '%', '-7.50m', '2m', '-1.50'],
  ['Add', '+', 'decimal.MaxValue', '-1m', '79228162514264337593543950334'],
  ['Subtract', '-', 'decimal.MinValue', '-1m', '-79228162514264337593543950334'],
  ['Multiply', '*', 'decimal.MaxValue', '1m', '79228162514264337593543950335'],
  ['Divide', '/', 'decimal.MaxValue', '10m', '7922816251426433759354395033.5'],
  ['Remainder', '%', 'decimal.MaxValue', '10m', '5']
]) test(`${name}(${left}, ${right}) matches the Decimal operator across all engines`, () => {
  assertOutput(`decimal left = ${left}; decimal right = ${right};
    Console.WriteLine(decimal.${name}(left, right)); Console.WriteLine(left ${operator} right);`,
  `${expected}\n${expected}\n`);
});

test('named d1/d2 arguments execute once in source order and preserve stored/boxed results', () => {
  assertOutput(`decimal value = D.Add(d2: Right(), d1: Left());
    decimal[] values = new decimal[] { value }; object boxed = values[0]; values[0] = 0m;
    Console.WriteLine(boxed); Console.WriteLine(System.Decimal.Subtract(d2: 2m, d1: 7m));
    Console.WriteLine(decimal.Add(7, 8L));`, 'RL3.30\n5\n15\n', `
      static decimal Left() { Console.Write("L"); return 1.10m; }
      static decimal Right() { Console.Write("R"); return 2.20m; }`);
});

for (const [name, left, right, fault] of [
  ['Add', 'decimal.MaxValue', '1m', 'OverflowException'],
  ['Subtract', 'decimal.MinValue', '1m', 'OverflowException'],
  ['Multiply', 'decimal.MaxValue', '2m', 'OverflowException'],
  ['Divide', 'decimal.MaxValue', '0.1m', 'OverflowException'],
  ['Divide', '1m', '0m', 'DivideByZeroException'],
  ['Remainder', '1m', '0m', 'DivideByZeroException']
]) test(`${name} retains ${fault} even in an unchecked context`, () => {
  const body = `decimal left = ${left}; decimal right = ${right}; unchecked { Console.WriteLine(D.${name}(left, right)); }`;
  for (const [engine, create] of engines(body)) {
    const result = create().run();
    assert.equal(result.state, 'faulted', engine);
    assert.equal(result.fault.name, fault, engine);
  }
});

test('source and reload reject unsupported arithmetic signatures rather than selecting by name', () => {
  for (const expression of ['decimal.Add(1m)', 'decimal.Subtract(null, 1m)', 'decimal.Multiply(1.0, 2m)',
    'decimal.Divide(1m, 2m, 3m)', 'decimal.Remainder("1", 2m)']) {
    const compiled = compileToIL(`using System; class P { static void Main() { Console.WriteLine(${expression}); } }`);
    assert.equal(compiled.success, false, expression);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'), expression);
  }
  for (const name of names) {
    const target = {owner: 'System.Decimal', name, sig: {kind: 'method', isStatic: true,
      returnType: 'System.Decimal', parameters: ['System.Decimal', 'System.Decimal']}};
    assert.equal(decodeDecimalBuiltin(target), BuiltinMap.get(`decimal.${name}#2`));
    for (const replacement of [{returnType: 'double'}, {isStatic: false}, {parameters: ['double', 'double']},
      {parameters: ['System.Decimal']}, {parameters: ['System.Decimal&', 'System.Decimal']}, {genericArity: 1}]) {
      assert.equal(decodeDecimalBuiltin({...target, sig: {...target.sig, ...replacement}}), null, name);
    }
  }
});
