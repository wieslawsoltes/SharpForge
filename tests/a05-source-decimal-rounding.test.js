import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {BuiltinMap, decimalIntrinsicDefinitions} from '@sharpforge/bytecode';
import {decodeDecimalBuiltin} from '../packages/cil/src/builtin-emission.js';

function artifact(body, members = '') {
  const source = `using System; using D = System.Decimal;
    class Program { static void Main() { ${body} } ${members} }`;
  const result = compileToIL(source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

function engines(compiled) {
  return [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reloaded source', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['direct CIL', () => new CilVirtualMachine(compiled.assembly)]
  ];
}

function output(body, expected, members = '') {
  for (const [name, create] of engines(artifact(body, members))) {
    const result = create().run();
    assert.equal(result.state, 'terminated', `${name}: ${result.fault?.stack}`);
    assert.equal(result.output, expected, name);
  }
}

test('source Decimal rounding appends distinct wire identities backed by the existing profile', () => {
  const previous = BuiltinMap.get('$type.long.GetType').id;
  const entries = ['decimal.Truncate#1', 'decimal.Round#1', 'decimal.Round#2'].map(name => BuiltinMap.get(name));
  assert.deepEqual(entries.map(entry => entry.id), [previous + 1, previous + 2, previous + 3]);
  assert.equal(new Set(entries.map(entry => entry.name)).size, 3);
  for (const entry of entries) {
    assert(decimalIntrinsicDefinitions.includes(entry.decimal));
    assert(Object.isFrozen(entry));
    assert(Object.isFrozen(entry.params));
    assert(Object.isFrozen(entry.parameterNames));
  }
});

test('Decimal Round uses midpoint-to-even for both signs and Truncate moves toward zero', () => {
  output(`
    Console.WriteLine(decimal.Round(2.5m)); Console.WriteLine(D.Round(3.5m));
    Console.WriteLine(System.Decimal.Round(-2.5m)); Console.WriteLine(D.Round(-3.5m));
    Console.WriteLine(D.Round(1.245m, 2)); Console.WriteLine(D.Round(1.255m, 2));
    Console.WriteLine(D.Round(-1.245m, 2)); Console.WriteLine(D.Round(-1.255m, 2));
    Console.WriteLine(decimal.Truncate(1.999m)); Console.WriteLine(D.Truncate(-1.999m));`,
  '2\n4\n-2\n-4\n1.24\n1.26\n-1.24\n-1.26\n1\n-1\n');
});

test('the semantic binder applies ordinary implicit integral-to-Decimal argument conversions', () => {
  output('Console.WriteLine(decimal.Round(7)); Console.WriteLine(D.Truncate(9L));', '7\n9\n');
});

test('rounding keeps exact Decimal scale, extreme values, array storage and boxing', () => {
  output(`
    Console.WriteLine(D.Round(1.2300m, 28)); Console.WriteLine(D.Round(0.000m, 2));
    Console.WriteLine(D.Round(decimal.MaxValue)); Console.WriteLine(D.Truncate(decimal.MinValue));
    Console.WriteLine(D.Round(0.0000000000000000000000000001m, 28));
    decimal[] values = new decimal[] { D.Round(1.255m, 2) }; object boxed = values[0];
    values[0] = 0m; Console.WriteLine(boxed);`,
  '1.2300\n0.00\n79228162514264337593543950335\n-79228162514264337593543950335\n' +
    '0.0000000000000000000000000001\n1.26\n');
});

test('real Decimal parameter names retain named-argument source evaluation order', () => {
  output('Console.WriteLine(D.Round(decimals: Digits(), d: Value())); Console.WriteLine(D.Truncate(d: 9.99m));',
    'DV1.24\n9\n', `
      static int Digits() { Console.Write("D"); return 2; }
      static decimal Value() { Console.Write("V"); return 1.245m; }`);
});

for (const digits of [-1, 29]) test(`Decimal Round rejects digit count ${digits} in every engine`, () => {
  for (const [name, create] of engines(artifact(`int digits = ${digits}; Console.WriteLine(D.Round(1.25m, digits));`))) {
    const result = create().run();
    assert.equal(result.state, 'faulted', name);
    assert.equal(result.fault.name, 'ArgumentOutOfRangeException', name);
  }
});

test('the source family preserves the existing captured native Round result', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/a05/decimal/native-reference.json', import.meta.url), 'utf8'));
  const hash = text => createHash('sha256').update(text).digest('hex');
  assert.equal(hash(reference.source), reference.sourceSha256);
  assert.equal(hash(reference.stdout), reference.outputSha256);
  assert(reference.source.includes('Console.WriteLine(decimal.Round(1.245M,2));'));
  output('Console.WriteLine(decimal.Round(1.245M, 2));', reference.stdout.split('\n')[3] + '\n');
});

test('source admission rejects unregistered overloads and internal wire names', () => {
  for (const expression of ['decimal.Round(1.25m, 2, 1)', 'decimal.Round(1.25)', 'decimal.Round(null)',
    'decimal.RoundDigits(1.25m, 2)', 'decimal.Truncate(1.25m, 1)']) {
    const compiled = compileToIL(`using System; class P { static void Main() { Console.WriteLine(${expression}); } }`);
    assert.equal(compiled.success, false, expression);
    assert(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error'), expression);
  }
});

test('reload matches the complete Decimal signature rather than just the method name', () => {
  const original = {owner: 'System.Decimal', name: 'Round',
    sig: {kind: 'method', isStatic: true, returnType: 'System.Decimal', parameters: ['System.Decimal', 'int']}};
  assert.equal(decodeDecimalBuiltin(original), BuiltinMap.get('decimal.Round#2'));
  assert.equal(decodeDecimalBuiltin({...original, sig: {...original.sig, parameters: ['decimal', 'System.Int32']}}),
    BuiltinMap.get('decimal.Round#2'));
  for (const replacement of [
    {kind: 'property'}, {isStatic: false}, {returnType: 'double'}, {parameters: ['double', 'int']},
    {genericArity: 1}, {callingConvention: 5}, {sentinel: 1}, {explicitThis: true}
  ]) {
    assert.equal(decodeDecimalBuiltin({...original, sig: {...original.sig, ...replacement}}), null, JSON.stringify(replacement));
  }
});
