import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {BuiltinMap, decimalIntrinsicDefinitions} from '@sharpforge/bytecode';
import {decodeDecimalBuiltin} from '../packages/cil/src/builtin-emission.js';

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

test('Ceiling and Floor append exact existing Decimal contracts without moving Parse or Round', () => {
  const previous = BuiltinMap.get('decimal.Parse#1').id;
  for (const [index, name] of ['Ceiling', 'Floor'].entries()) {
    const entry = BuiltinMap.get(`decimal.${name}#1`);
    assert.equal(entry.id, previous + index + 1);
    assert(decimalIntrinsicDefinitions.includes(entry.decimal));
    assert.deepEqual(entry.params, ['decimal']);
    assert.deepEqual(entry.parameterNames, ['d']);
    assert.equal(entry.result, 'decimal');
    assert(Object.isFrozen(entry));
  }
});

test('directed integral rounding retains Decimal precision for both signs on all three engines', () => {
  const cases = [
    ['1.01m', '2', '1'], ['1.99m', '2', '1'], ['-1.01m', '-1', '-2'], ['-1.99m', '-1', '-2'],
    ['1.0000m', '1', '1'], ['-1.0000m', '-1', '-1'], ['0.0000m', '0', '0'],
    ['0.0000000000000000000000000001m', '1', '0'], ['-0.0000000000000000000000000001m', '0', '-1'],
    ['7922816251426433759354395033.5m', '7922816251426433759354395034', '7922816251426433759354395033'],
    ['-7922816251426433759354395033.5m', '-7922816251426433759354395033', '-7922816251426433759354395034'],
    ['decimal.MaxValue', '79228162514264337593543950335', '79228162514264337593543950335'],
    ['decimal.MinValue', '-79228162514264337593543950335', '-79228162514264337593543950335']
  ];
  const body = cases.map(([value]) =>
    `Console.WriteLine(decimal.Ceiling(${value})); Console.WriteLine(D.Floor(${value}));`).join('\n');
  const expected = cases.map(([, ceiling, floor]) => `${ceiling}\n${floor}\n`).join('');
  for (const [engine, create] of engines(body)) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, expected, engine);
  }
});

test('named arguments, integral widening, arrays and boxing preserve directed rounding values', () => {
  const body = `decimal[] values = new decimal[] { System.Decimal.Ceiling(d: 1.01m), D.Floor(d: -1.01m) };
    object first = values[0]; object second = values[1]; values[0] = 0m; values[1] = 0m;
    Console.WriteLine(first); Console.WriteLine(second);
    Console.WriteLine(decimal.Ceiling(7)); Console.WriteLine(decimal.Floor(-9L));`;
  for (const [engine, create] of engines(body)) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, '2\n-2\n7\n-9\n', engine);
  }
});

test('source admission and reload keep directed rounding to the exact static Decimal overloads', () => {
  for (const name of ['Ceiling', 'Floor']) {
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
      {parameters: ['System.Decimal', 'int']}, {genericArity: 1}, {callingConvention: 5}]) {
      assert.equal(decodeDecimalBuiltin({...target, sig: {...target.sig, ...replacement}}), null, name);
    }
    assert.equal(decodeDecimalBuiltin({...target, owner: 'System.Math'}), null);
  }
});
