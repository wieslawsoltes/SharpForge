import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {BuiltinMap, Op, decimalIntrinsicDefinitions} from '@sharpforge/bytecode';
import {decodeDecimalBuiltin} from '../packages/cil/src/builtin-emission.js';

function artifact(body, members = '') {
  const compiled = compileToIL(`using System; using M = System.Math;
    class Program { static void Main() { ${body} } ${members} }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return compiled;
}

function assertOutput(body, expected, members = '') {
  const compiled = artifact(body, members);
  const engines = [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reloaded source', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['direct CIL', () => new CilVirtualMachine(compiled.assembly)]
  ];
  for (const [engine, create] of engines) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${engine}: ${result.fault?.stack}`);
    assert.equal(result.output, expected, engine);
  }
}

function builtinIds(image) {
  const result = [];
  for (const method of image.methods) {
    for (let index = 0; index < method.code.length; index += 3) {
      if (method.code[index] === Op.BUILTIN) result.push(method.code[index + 1]);
    }
  }
  return result;
}

test('Math.Sign appends one exact owner-qualified Decimal descriptor without changing released Math entries', () => {
  const entry = BuiltinMap.get('Math.Sign#1:Decimal');
  assert.equal(entry.id, BuiltinMap.get('decimal.GetBits#1').id + 1);
  assert(decimalIntrinsicDefinitions.includes(entry.decimal));
  assert.equal(entry.decimal.owner, 'System.Math');
  assert.equal(entry.decimal.name, 'Sign');
  assert.deepEqual(entry.params, ['decimal']);
  assert.deepEqual(entry.parameterNames, ['value']);
  assert.equal(entry.result, 'int');
  assert.equal(BuiltinMap.get('Math.Min').id, 3);
  assert.equal(BuiltinMap.get('Math.Max').id, 4);
  assert.equal(BuiltinMap.get('Math.Min').decimal, undefined);
  assert.equal(BuiltinMap.get('Math.Max').decimal, undefined);
  assert(Object.isFrozen(entry));
});

test('Decimal Sign handles the full coefficient range, tiny magnitudes, scale and either zero sign', () => {
  const values = [
    ['decimal.MinValue', -1], ['-1.2300m', -1], ['-0.0000000000000000000000000001m', -1],
    ['decimal.Parse("-0.0000")', 0], ['0.0000m', 0], ['0m', 0],
    ['0.0000000000000000000000000001m', 1], ['1.2300m', 1], ['decimal.MaxValue', 1]
  ];
  const body = values.map(([value]) => `Console.WriteLine(Math.Sign(${value}));`).join('\n');
  assertOutput(body, values.map(([, sign]) => sign + '\n').join(''));
});

test('Sign returns Int32 through arrays, boxing, arithmetic and single named-argument evaluation', () => {
  assertOutput(`int result = M.Sign(value: Read()); int[] signs = new int[] { result };
    object boxed = signs[0]; signs[0] = 0;
    Console.WriteLine(boxed); Console.WriteLine(boxed.GetType().FullName);
    if (result < 0) Console.WriteLine(result + 2);
    Console.WriteLine(System.Math.Sign(0)); Console.WriteLine(Math.Sign(long.MinValue));
    Console.WriteLine(Math.Sign(uint.MaxValue)); Console.WriteLine(Math.Sign((decimal)ulong.MaxValue));`,
  'R-1\nSystem.Int32\n1\n0\n-1\n1\n1\n',
  'static decimal Read() { Console.Write("R"); return -1.25m; }');
});

test('existing Min/Max call admission coexists with Decimal Sign and exact integral overloads', () => {
  for (const [argumentsText, suffix] of [['1, 2', ':Int32'], ['1.25, 2.5', ''], ['1u, 2u', ':UInt32'],
    ['1L, 2L', ':Int64'], ['1UL, 2UL', ':UInt64'], ['1, 2.5', '']]) {
    const compiled = artifact(`Console.WriteLine(Math.Min(${argumentsText}));
      Console.WriteLine(Math.Max(${argumentsText})); Console.WriteLine(Math.Sign(-1m));`);
    for (const image of [compiled.image, loadAssembly(compiled.assembly)]) {
      const ids = builtinIds(image);
      // New semantic calls select exact integral entries; released wire images keep their old IDs.
      assert(ids.includes(BuiltinMap.get('Math.Min' + (suffix ? '#2' + suffix : '')).id), argumentsText);
      assert(ids.includes(BuiltinMap.get('Math.Max' + (suffix ? '#2' + suffix : '')).id), argumentsText);
      assert(ids.includes(BuiltinMap.get('Math.Sign#1:Decimal').id), argumentsText);
    }
  }
});

test('Sign selection checks owner and complete signature rather than sharing a method name', () => {
  const target = {owner: 'System.Math', name: 'Sign',
    sig: {kind: 'method', isStatic: true, returnType: 'int', parameters: ['System.Decimal']}};
  assert.equal(decodeDecimalBuiltin(target), BuiltinMap.get('Math.Sign#1:Decimal'));
  for (const owner of ['System.Decimal', 'System.MathF', 'Other.Math']) {
    assert.equal(decodeDecimalBuiltin({...target, owner}), null);
  }
  for (const replacement of [{returnType: 'System.Decimal'}, {returnType: 'double'}, {isStatic: false},
    {parameters: ['double']}, {parameters: ['int']}, {parameters: ['System.Decimal&']},
    {parameters: []}, {genericArity: 1}, {callingConvention: 5}]) {
    assert.equal(decodeDecimalBuiltin({...target, sig: {...target.sig, ...replacement}}), null);
  }
  const decimal = {owner: 'System.Decimal', name: 'Abs',
    sig: {kind: 'method', isStatic: true, returnType: 'System.Decimal', parameters: ['System.Decimal']}};
  assert.equal(decodeDecimalBuiltin(decimal), BuiltinMap.get('decimal.Abs#1'));
  assert.equal(decodeDecimalBuiltin({...decimal, owner: 'System.Math'}), null);
});

test('Decimal Sign source registration rejects unsupported overloads and wrong result conversions', () => {
  for (const body of [
    'Math.Sign();', 'Math.Sign(null);',
    'Math.Sign(1m, 2m);', 'Math.Sign(d: 1m);', 'decimal.Sign(1m);',
    'bool value = Math.Sign(1m);'
  ]) {
    const compiled = compileToIL(`using System; class P { static void Main() { ${body} } }`);
    assert.equal(compiled.success, false, body);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'), body);
  }
});
