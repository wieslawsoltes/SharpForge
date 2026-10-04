import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {BuiltinMap, decimalIntrinsicDefinitions} from '@sharpforge/bytecode';
import {loadAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {decodeDecimalBuiltin} from '../packages/cil/src/builtin-emission.js';

function artifact(body, members = '') {
  const compiled = compileToIL(`using System; using M = System.Math;
    class P { static void Main() { ${body} } ${members} }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return compiled;
}

function assertOutput(body, expected, members = '') {
  const compiled = artifact(body, members);
  const engines = [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reload', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['CIL', () => new CilVirtualMachine(compiled.assembly)]
  ];
  for (const [name, create] of engines) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${name}: ${result.fault?.stack}`);
    assert.equal(result.output, expected, name);
  }
}

test('Decimal extrema append after all integral Math IDs with exact owner, result and parameter names', () => {
  const start = BuiltinMap.get('Math.Sign#1:Decimal').id + 1;
  let offset = 0;
  for (const suffix of ['Int32', 'UInt32', 'Int64', 'UInt64']) {
    for (const name of ['Min', 'Max']) assert.equal(BuiltinMap.get(`Math.${name}#2:${suffix}`).id, start + offset++);
  }
  for (const name of ['Min', 'Max']) {
    const entry = BuiltinMap.get(`Math.${name}#2:Decimal`);
    assert.equal(entry.id, start + offset++);
    assert.equal(entry.decimal.owner, 'System.Math');
    assert.equal(entry.decimal.name, name);
    assert(decimalIntrinsicDefinitions.includes(entry.decimal));
    assert.deepEqual(entry.params, ['decimal', 'decimal']);
    assert.deepEqual(entry.parameterNames, ['val1', 'val2']);
    assert.equal(entry.result, 'decimal');
    assert(Object.isFrozen(entry));
  }
  assert.equal(BuiltinMap.get('Math.Min').id, 3);
  assert.equal(BuiltinMap.get('Math.Max').id, 4);
});

test('Decimal Min/Max retain full coefficient range, precision, scale and ordinary storage', () => {
  assertOutput(`decimal[] values = new decimal[] {
    Math.Min(decimal.MinValue, decimal.MaxValue), Math.Max(decimal.MinValue, decimal.MaxValue),
    Math.Min(-0.0000000000000000000000000001m, 0m), Math.Max(0m, 0.0000000000000000000000000001m),
    Math.Min(1.2300m, 1.23m), Math.Max(1.2300m, 1.23m),
    Math.Min(18446744073709551617m, 18446744073709551616m)
  };
  foreach (decimal value in values) Console.WriteLine(value);
  object boxed = values[5]; Console.WriteLine(boxed.GetType().FullName); Console.WriteLine(boxed);`,
  '-79228162514264337593543950335\n79228162514264337593543950335\n' +
  '-0.0000000000000000000000000001\n0.0000000000000000000000000001\n1.23\n1.2300\n' +
  '18446744073709551616\nSystem.Decimal\n1.2300\n');
});

test('equal Decimal zeros retain the selected operand sign and scale, not just equal formatted text', () => {
  assertOutput(`decimal negative = decimal.Parse("-0.0000"); decimal positive = 0.00m;
    Console.WriteLine(decimal.GetBits(Math.Min(negative, positive))[3]);
    Console.WriteLine(decimal.GetBits(Math.Max(negative, positive))[3]);
    Console.WriteLine(decimal.GetBits(Math.Min(positive, negative))[3]);
    Console.WriteLine(decimal.GetBits(Math.Max(positive, negative))[3]);
    Console.WriteLine(decimal.GetBits(negative)[3]); Console.WriteLine(decimal.GetBits(positive)[3]);`,
  '131072\n-2147221504\n-2147221504\n131072\n-2147221504\n131072\n');
});

test('named Decimal arguments preserve source evaluation order and qualified Math identity', () => {
  assertOutput(`Console.WriteLine(M.Min(val2: Read(1), val1: Read(2)));
    Console.WriteLine(System.Math.Max(val1: Read(1), val2: Read(2)));`,
  '120.0100\n122.50\n',
  'static decimal Read(int id) { Console.Write(id); return id == 1 ? 0.0100m : 2.50m; }');
});

test('valid small, wide and mixed integral calls keep their admission beside Decimal overloads', () => {
  assertOutput(`byte b = 1; byte b2 = 2; short s = -3; short s2 = 4; char c = 'A'; char c2 = 'B';
    uint u = uint.MaxValue; long l = long.MinValue; ulong ul = ulong.MaxValue; int i = -1;
    Console.WriteLine(Math.Min(b, b2)); Console.WriteLine(Math.Max(s, s2)); Console.WriteLine(Math.Max(c, c2));
    Console.WriteLine(Math.Max(u, u)); Console.WriteLine(Math.Min(l, l)); Console.WriteLine(Math.Max(ul, ul));
    Console.WriteLine(Math.Min(i, u)); Console.WriteLine(Math.Min(l, u)); Console.WriteLine(Math.Max(u, ul));
    Console.WriteLine(Math.Min(1, ul));
    Console.WriteLine(Math.Min(u, 4294967296m)); Console.WriteLine(Math.Max(l, -1m));
    Console.WriteLine(Math.Min(ul, decimal.MaxValue));
    Console.WriteLine(Math.Min(1.5f, 2.5)); Console.WriteLine(Math.Max(1, 2.5));`,
  '1\n4\n66\n4294967295\n-9223372036854775808\n18446744073709551615\n' +
  '-1\n-9223372036854775808\n18446744073709551615\n1\n4294967295\n-1\n18446744073709551615\n1.5\n2.5\n');
});

test('formerly over-admitted signed-variable/UInt64 calls now report standard overload ambiguity', () => {
  // Pinned C# §§10.2.3, 12.6.4.1/.5/.7: both floating and Decimal candidates apply; neither is better.
  for (const type of ['int', 'long']) {
    for (const name of ['Min', 'Max']) {
      for (const args of ['signed, unsigned', 'unsigned, signed']) {
        const compiled = compileToIL(`using System; class P { static void Main() {
          ${type} signed = -1; ulong unsigned = ulong.MaxValue; Math.${name}(${args}); } }`);
        assert.equal(compiled.success, false, `${type}: ${name}(${args})`);
        assert(compiled.diagnostics.some(diagnostic => diagnostic.code === 'CS0121' && diagnostic.severity === 'error'));
      }
    }
  }
});

test('an explicit Double or Decimal cast resolves mixed signed/unsigned intent across engines', () => {
  assertOutput(`long signed = -1; int small = -2; ulong unsigned = ulong.MaxValue;
    Console.WriteLine(Math.Min((double)signed, unsigned));
    Console.WriteLine(Math.Max((double)small, unsigned) == (double)unsigned);
    Console.WriteLine(Math.Min((decimal)signed, unsigned));
    Console.WriteLine(Math.Max((decimal)small, unsigned));`,
  '-1\nTrue\n-1\n18446744073709551615\n');
});

test('Decimal decoder distinguishes same-named owners and every parameter/result category', () => {
  for (const name of ['Min', 'Max']) {
    const target = {owner: 'System.Math', name,
      sig: {kind: 'method', isStatic: true, returnType: 'System.Decimal', parameters: ['System.Decimal', 'System.Decimal']}};
    assert.equal(decodeDecimalBuiltin(target), BuiltinMap.get(`Math.${name}#2:Decimal`));
    for (const owner of ['System.Decimal', 'System.MathF', 'Other.Math']) {
      assert.equal(decodeDecimalBuiltin({...target, owner}), null);
    }
    for (const replacement of [{returnType: 'double'}, {returnType: 'int'}, {isStatic: false},
      {parameters: ['System.Decimal', 'int']}, {parameters: ['System.Decimal&', 'System.Decimal']},
      {parameters: ['System.Decimal']}, {genericArity: 1}, {callingConvention: 5}]) {
      assert.equal(decodeDecimalBuiltin({...target, sig: {...target.sig, ...replacement}}), null);
    }
  }
  for (const body of ['Math.Min(1m, 1.0);', 'Math.Max(1m, 1f);', 'Math.Min(val1: 1m);',
    'Math.Min(d1: 1m, d2: 2m);', 'bool value = Math.Max(1m, 2m);']) {
    assert.equal(compileToIL(`using System; class P { static void Main() { ${body} } }`).success, false, body);
  }
});
