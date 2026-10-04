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

function staticValue(vm, name) {
  const slot = vm.inspector
    ? [...vm.inspector.fields.values()].find(field => field.name === name)?.token
    : vm.image.statics.findIndex(field => field.name === 'Program.' + name);
  assert(slot !== undefined && slot !== -1, 'Missing ' + name);
  return vm.inspector ? vm.statics.get(slot) : vm.statics[slot];
}

test('floating conversion entries append exact float/double results and named d parameters', () => {
  const previous = BuiltinMap.get('decimal.ToUInt64#1').id;
  for (const [index, [name, result]] of [['ToSingle', 'float'], ['ToDouble', 'double']].entries()) {
    const entry = BuiltinMap.get(`decimal.${name}#1`);
    assert.equal(entry.id, previous + index + 1);
    assert(decimalIntrinsicDefinitions.includes(entry.decimal));
    assert.deepEqual(entry.params, ['decimal']);
    assert.deepEqual(entry.parameterNames, ['d']);
    assert.equal(entry.result, result);
    assert.equal(entry.decimal.returnType, result);
    assert(Object.isFrozen(entry));
  }
});

test('floating conversion results retain rounded carriers, finite full range and signed zero', () => {
  const cases = [
    ['0.1m', 0.10000000149011612, 0.1], ['-0.1m', -0.10000000149011612, -0.1],
    ['16777217m', 16777216, 16777217], ['16777219m', 16777220, 16777219],
    ['-16777217m', -16777216, -16777217], ['-16777219m', -16777220, -16777219],
    ['9007199254740993m', 9007199254740992, 9007199254740992],
    ['9007199254740995m', 9007199254740992, 9007199254740996],
    ['0.125m', 0.125, 0.125], ['decimal.MaxValue', 2 ** 96, 2 ** 96],
    ['decimal.MinValue', -(2 ** 96), -(2 ** 96)],
    ['0.0000m', 0, 0], ['decimal.Parse("-0.0000")', -0, -0]
  ];
  const singles = cases.map(([input]) => `D.ToSingle(${input})`).join(',');
  const doubles = cases.map(([input]) => `decimal.ToDouble(${input})`).join(',');
  const body = `Singles = new float[] { ${singles} }; Doubles = new double[] { ${doubles} };`;
  for (const [engine, create] of engines(body, 'static float[] Singles; static double[] Doubles;')) {
    const vm = create(), result = vm.run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    const singleValues = vm.heap.get(staticValue(vm, 'Singles')).data;
    const doubleValues = vm.heap.get(staticValue(vm, 'Doubles')).data;
    for (const [index, [input, single, double]] of cases.entries()) {
      for (const [actual, kind, expected] of [[singleValues[index], 'r4', single], [doubleValues[index], 'r8', double]]) {
        assert.equal(actual.float, kind, `${engine}: ${input}`);
        assert(Object.is(actual.value, expected), `${engine}: ${kind} ${input}`);
        assert(Number.isFinite(actual.value), `${engine}: ${kind} ${input}`);
        assert(Object.isFrozen(actual), `${engine}: ${kind} ${input}`);
      }
    }
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat32(0, singleValues[0].value, false);
    assert.equal(bits.getUint32(0, false), 0x3dcccccd, engine);
    bits.setFloat64(0, doubleValues[0].value, false);
    assert.equal(bits.getBigUint64(0, false), 0x3fb999999999999an, engine);
  }
});

test('Single results widen after rounding and both result types retain their boxes and named evaluation', () => {
  assertOutput(`float single = D.ToSingle(d: Read()); double dual = System.Decimal.ToDouble(d: Read());
    object first = single; object second = dual; single = 0f; dual = 0d;
    Console.WriteLine(first); Console.WriteLine(second);
    Console.WriteLine(first.GetType().FullName); Console.WriteLine(second.GetType().FullName);
    Console.WriteLine((double)decimal.ToSingle(16777217m)); Console.WriteLine(decimal.ToDouble(16777217m));
    Console.WriteLine(decimal.ToSingle(7)); Console.WriteLine(decimal.ToDouble(7));`,
  'RR0.1\n0.1\nSystem.Single\nSystem.Double\n16777216\n16777217\n7\n7\n',
  'static decimal Read() { Console.Write("R"); return 0.1m; }');
});

test('both floating methods retain negative zero through arithmetic in either checked context', () => {
  const body = ['checked', 'unchecked'].map(mode => `${mode} {
    decimal negative = decimal.Parse("-0.000");
    Console.WriteLine(1f / decimal.ToSingle(negative)); Console.WriteLine(1d / decimal.ToDouble(negative));
    Console.WriteLine(1f / decimal.ToSingle(0m)); Console.WriteLine(1d / decimal.ToDouble(0m));
  }`).join('\n');
  assertOutput(body, '-Infinity\n-Infinity\nInfinity\nInfinity\n'.repeat(2));
});

test('floating registration rejects incompatible arguments, result narrowing and reload signatures', () => {
  for (const [name, result] of [['ToSingle', 'float'], ['ToDouble', 'double']]) {
    for (const argumentsText of ['', '0.1', 'null', '1m, 2', 'value: 1m']) {
      const expression = `decimal.${name}(${argumentsText})`;
      const compiled = compileToIL(`using System; class P { static void Main() { Console.WriteLine(${expression}); } }`);
      assert.equal(compiled.success, false, expression);
      assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'), expression);
    }
    const target = {owner: 'System.Decimal', name,
      sig: {kind: 'method', isStatic: true, returnType: result, parameters: ['System.Decimal']}};
    assert.equal(decodeDecimalBuiltin(target), BuiltinMap.get(`decimal.${name}#1`));
    for (const replacement of [{returnType: result === 'float' ? 'double' : 'float'}, {returnType: 'System.Decimal'},
      {isStatic: false}, {parameters: ['double']}, {parameters: ['System.Decimal&']},
      {parameters: []}, {genericArity: 1}, {callingConvention: 5}]) {
      assert.equal(decodeDecimalBuiltin({...target, sig: {...target.sig, ...replacement}}), null, name);
    }
  }
  for (const declaration of ['float value = decimal.ToDouble(1m);', 'int value = decimal.ToSingle(1m);']) {
    const compiled = compileToIL(`using System; class P { static void Main() { ${declaration} } }`);
    assert.equal(compiled.success, false, declaration);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'), declaration);
  }
});
