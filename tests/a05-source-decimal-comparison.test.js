import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {BuiltinMap, decimalIntrinsicDefinitions} from '@sharpforge/bytecode';
import {decodeDecimalBuiltin} from '../packages/cil/src/builtin-emission.js';

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

test('comparison entries append explicit int/bool results without changing Decimal-returning entries', () => {
  const previous = BuiltinMap.get('decimal.Remainder#2').id;
  for (const [index, [name, result]] of [['Compare', 'int'], ['Equals', 'bool']].entries()) {
    const entry = BuiltinMap.get(`decimal.${name}#2`);
    assert.equal(entry.id, previous + index + 1);
    assert(decimalIntrinsicDefinitions.includes(entry.decimal));
    assert.equal(entry.result, result);
    assert.equal(entry.decimal.returnType, result);
    assert.deepEqual(entry.params, ['decimal', 'decimal']);
    assert.deepEqual(entry.parameterNames, ['d1', 'd2']);
    assert(Object.isFrozen(entry));
  }
  assert.equal(BuiltinMap.get('decimal.Add#2').result, 'decimal');
  assert.equal(BuiltinMap.get('decimal.Round#2').result, 'decimal');
});

test('static comparisons ignore scale and zero sign while retaining exact 96-bit ordering', () => {
  const cases = [
    ['1.0m', '1.00m', 0, true], ['-1.00m', '-1.0m', 0, true],
    ['decimal.Parse("-0.0000")', '0m', 0, true], ['1m', '2m', -1, false], ['2m', '1m', 1, false],
    ['-2m', '-1m', -1, false], ['-1m', '-2m', 1, false],
    ['0.0000000000000000000000000001m', '0m', 1, false],
    ['-0.0000000000000000000000000001m', '0m', -1, false],
    ['79228162514264337593543950334m', 'decimal.MaxValue', -1, false],
    ['decimal.MinValue', '-79228162514264337593543950334m', -1, false],
    ['decimal.MaxValue', 'decimal.MinValue', 1, false]
  ];
  const body = cases.map(([left, right]) => `{
    decimal left = ${left}; decimal right = ${right};
    int order = decimal.Compare(left, right); bool equal = D.Equals(left, right);
    Console.WriteLine(order); Console.WriteLine(equal); Console.WriteLine(equal == (left == right));
  }`).join('\n');
  const expected = cases.map(([, , order, equal]) => `${order}\n${equal ? 'True' : 'False'}\nTrue\n`).join('');
  assertOutput(body, expected);
});

test('comparison results retain int/bool storage, boxing and control-flow behavior', () => {
  assertOutput(`int[] orders = new int[] { System.Decimal.Compare(1m, 2m) };
    bool[] matches = new bool[] { decimal.Equals(1.0m, 1.00m) };
    object order = orders[0]; object equal = matches[0];
    Console.WriteLine(order); Console.WriteLine(equal);
    if (matches[0]) Console.WriteLine(orders[0] + 2);
    Console.WriteLine(decimal.Compare(7, 8L)); Console.WriteLine(decimal.Equals(7, 7L));`,
  '-1\nTrue\n1\n-1\nTrue\n');
});

test('named d1/d2 arguments evaluate once in source order for int and bool returns', () => {
  assertOutput(`Console.WriteLine(D.Compare(d2: Right(), d1: Left()));
    Console.WriteLine(D.Equals(d2: Right(), d1: Left()));`, 'RL-1\nRLFalse\n', `
      static decimal Left() { Console.Write("L"); return 1.10m; }
      static decimal Right() { Console.Write("R"); return 2.20m; }`);
});

test('comparison registration does not introduce implicit result or operand conversions', () => {
  for (const body of [
    'bool value = decimal.Compare(1m, 2m);', 'int value = decimal.Equals(1m, 2m);',
    'Console.WriteLine(decimal.Compare(1.0, 2m));', 'Console.WriteLine(decimal.Compare(null, 2m));',
    'Console.WriteLine(decimal.Equals(1m));', 'Console.WriteLine(decimal.Equals(1m, 2m, 3m));'
  ]) {
    const compiled = compileToIL(`using System; class P { static void Main() { ${body} } }`);
    assert.equal(compiled.success, false, body);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'), body);
  }
  for (const [name, returnType] of [['Compare', 'int'], ['Equals', 'bool']]) {
    const target = {owner: 'System.Decimal', name,
      sig: {kind: 'method', isStatic: true, returnType, parameters: ['System.Decimal', 'System.Decimal']}};
    assert.equal(decodeDecimalBuiltin(target), BuiltinMap.get(`decimal.${name}#2`));
    for (const replacement of [{returnType: 'System.Decimal'}, {returnType: name === 'Compare' ? 'bool' : 'int'},
      {isStatic: false}, {parameters: ['object', 'object']}, {parameters: ['System.Decimal&', 'System.Decimal']},
      {parameters: ['System.Decimal']}, {genericArity: 1}]) {
      assert.equal(decodeDecimalBuiltin({...target, sig: {...target.sig, ...replacement}}), null, name);
    }
  }
});
