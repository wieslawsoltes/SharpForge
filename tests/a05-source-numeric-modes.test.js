import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {loadAssembly} from '@sharpforge/cil';
import {Op, Binary, NumericType, numericMode, serializeImage, deserializeImage, verifyImage} from '@sharpforge/bytecode';

function artifact(body) {
  const source = `using System; class Program { static void Main() { ${body} } }`;
  const result = compileToIL(source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}

function engines(result, options = {}) {
  return [new VirtualMachine(result.image, options), new VirtualMachine(loadAssembly(result.assembly), options),
    new CilVirtualMachine(result.assembly, options)];
}

for (const [type, literal, expected] of [
  ['long', '2147483648L', '2147483648\n'],
  ['float', '1.25f', '1.25\n'],
  ['decimal', '1.20m', '1.20\n'],
]) test(`top-level ${type} retains the profile Console receiver shorthand`, () => {
  const result = compileToIL(`${type} value = ${literal}; Console.WriteLine(value);`);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.equal(result.semantic?.complete, true);
  for (const vm of engines(result)) assert.equal(vm.run().output, expected);
});

test('profile receiver fallback respects explicit aliases and using policy', () => {
  const result = compileToIL(`using Console = UserConsole;
    long value = 2L; Console.WriteLine(value);
    class UserConsole { public static void WriteLine(long value) { System.Console.WriteLine(value + 1); } }`);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  for (const vm of engines(result)) assert.equal(vm.run().output, '3\n');
  for (const implicitUsings of [false, []]) {
    assert.equal(compile('long value = 2L; Console.WriteLine(value);', {implicitUsings}).success, false);
  }
  const invalid = compile('long Console = 2L; Console.WriteLine(1);');
  assert.equal(invalid.success, false);
});

for (const [type, literal] of [
  ['byte', '255'], ['uint', '4294967295U'], ['long', '2147483648L'], ['ulong', '18446744073709551615UL'],
  ['nint', '(nint)17'], ['float', '1.25f'], ['decimal', '1.20m'],
]) test(`captured ${type} delegate returns use typed synthesized defaults`, () => {
  const result = artifact(`${type} value = ${literal}; Func<${type}> read = () => value; Console.WriteLine(read() == value);`);
  for (const vm of engines(result)) {
    const actual = vm.run();
    assert.equal(actual.state, 'terminated', actual.fault?.stack);
    assert.equal(actual.output, 'True\n');
  }
});

test('predefined numeric bounds complete semantic admission instead of retaining legacy profile errors', () => {
  const result = artifact(`
    long signed = int.MaxValue; ulong unsigned = ulong.MaxValue; uint small = uint.MaxValue;
    nint native = (nint)int.MaxValue;
    Console.WriteLine(signed); Console.WriteLine(unsigned); Console.WriteLine(small);
    Console.WriteLine((long)native);`);
  assert.equal(result.semantic?.complete, true);
  assert(!result.diagnostics.some(diagnostic => ['SF1003', 'SF1004', 'SF1005', 'SF2200'].includes(diagnostic.code)));
  for (const vm of engines(result)) {
    assert.equal(vm.run().output, '2147483647\n18446744073709551615\n4294967295\n2147483647\n');
  }
});

test('lossless Decimal lexer values survive semantic constants and declaration defaults', () => {
  const result = artifact('const decimal amount = 1.2300m; decimal maximum = decimal.MaxValue; Console.WriteLine(amount); Console.WriteLine(maximum);');
  assert.equal(result.semantic?.complete, true);
  for (const vm of engines(result)) assert.equal(vm.run().output, '1.2300\n79228162514264337593543950335\n');
  const invalid = compile('class P { static void Main() { int.MaxValue = 3; } }');
  assert.equal(invalid.success, false);
  assert(invalid.diagnostics.some(diagnostic => ['CS0131', 'CS0200'].includes(diagnostic.code)));
});

const fixtures = [
  ['Int64 increment crosses the Int32 boundary', 'long x = int.MaxValue; x++; Console.WriteLine(x);', '2147483648\n'],
  ['unsigned arithmetic and comparison', `
    uint x = uint.MaxValue; uint one = 1; Console.WriteLine(x); Console.WriteLine(x > one);
    x += one; Console.WriteLine(x); ulong y = ulong.MaxValue; Console.WriteLine(y); y++; Console.WriteLine(y);
    y = 1UL; Console.WriteLine(y << 63); Console.WriteLine(y << 64);`,
  '4294967295\nTrue\n0\n18446744073709551615\n0\n9223372036854775808\n1\n'],
  ['narrow compound assignments and UTF16 char', `
    byte b = 255; b++; sbyte s = 127; s++; short h = 32767; h++; ushort u = 65535; u++;
    char c = 'A'; c++; Console.WriteLine(b); Console.WriteLine(s); Console.WriteLine(h);
    Console.WriteLine(u); Console.WriteLine(c);`, '0\n-128\n-32768\n0\nB\n'],
  ['Float32 rounds each operation', `
    float x = 16777216f; x += 1f; Console.WriteLine(x - 16777216f);
    float y = 0.1f; Console.WriteLine(y); double z = 0.1; Console.WriteLine(z);
    float zero = 0f; Console.WriteLine(zero / zero); Console.WriteLine(1f / zero);`, '0\n0.1\n0.1\nNaN\nInfinity\n'],
  ['typed conversions remain compatible with legacy Double operators', `
    float f = 1.5f; double d = f; Console.WriteLine(-d); Console.WriteLine(+d);
    long l = 3; d = l; Console.WriteLine(d + 0.5);`, '-1.5\n1.5\n3.5\n'],
  ['Decimal is exact and retains scale', `
    decimal x = 0.1m; decimal y = 0.2m; Console.WriteLine(x + y);
    x = 1.20m; y = 1.00m; Console.WriteLine(x + y); Console.WriteLine(x > y);
    Console.WriteLine((long)(x + y)); Console.WriteLine(-x);`, '0.3\n2.20\nTrue\n2\n-1.20\n'],
  ['signed to unsigned widening and logical shift', `
    int i = -1; Console.WriteLine(unchecked((ulong)i)); long l = -1;
    Console.WriteLine(l >>> 1); uint u = uint.MaxValue; Console.WriteLine((long)u);
    Console.WriteLine((double)u);`, '18446744073709551615\n9223372036854775807\n4294967295\n4294967295\n'],
  ['typed arrays, object boxes and concatenation', `
    ulong[] values = new ulong[] { ulong.MaxValue, 1UL }; values[1] += values[0];
    Console.WriteLine(values[0]); Console.WriteLine(values[1]); object boxed = uint.MaxValue;
    Console.WriteLine(boxed); Console.WriteLine("value=" + values[0]);`, '18446744073709551615\n0\n4294967295\nvalue=18446744073709551615\n'],
];

for (const [name, body, expected] of fixtures) test(`source numeric modes: ${name} on all three engines`, () => {
  const result = artifact(body);
  for (const vm of engines(result)) {
    const actual = vm.run();
    assert.equal(actual.state, 'terminated', actual.fault?.stack);
    assert.equal(actual.output, expected);
  }
  const copied = deserializeImage(serializeImage(result.image));
  assert.deepEqual(verifyImage(copied), []);
  assert.equal(new VirtualMachine(copied).run().output, expected);
});

for (const nativeIntBits of [32, 64]) test(`source native${nativeIntBits} modes bind to the VM ABI`, () => {
  const result = artifact(`
    nint x = (nint)2147483647; x++; Console.WriteLine((long)x);
    nuint y = (nuint)uint.MaxValue; y++; Console.WriteLine((ulong)y);`);
  const expected = nativeIntBits === 32 ? '-2147483648\n0\n' : '2147483648\n4294967296\n';
  for (const vm of engines(result, {nativeIntBits})) {
    assert.throws(() => { vm.options.nativeIntBits = nativeIntBits === 32 ? 64 : 32; }, TypeError);
    const actual = vm.run();
    assert.equal(actual.state, 'terminated', actual.fault?.stack);
    assert.equal(actual.output, expected);
  }
});

for (const body of [
  'long x = long.MaxValue; checked { x++; }',
  'uint x = uint.MaxValue; checked { x++; }',
  'byte x = 255; checked { x++; }',
  'decimal x = 79228162514264337593543950335m; x++;',
]) test(`source checked numeric failure: ${body}`, () => {
  for (const vm of engines(artifact(body))) {
    const result = vm.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'OverflowException');
  }
});

test('source numeric modes preserve mutable state and immutable values across snapshot replay and stop', () => {
  const result = artifact('long x = 2147483647L; decimal d = 1.20m; for (int i = 0; i < 5; i++) { x++; d += 0.10m; } Console.WriteLine(x); Console.WriteLine(d);');
  for (const vm of engines(result)) {
    vm.runSlice({instructionBudget: 17, timeBudgetMs: 1000});
    const saved = vm.snapshot(), first = vm.run();
    assert.equal(first.state, 'terminated', first.fault?.stack);
    assert.equal(first.output, '2147483652\n1.70\n');
    vm.restore(saved);
    assert.equal(vm.run().output, first.output);
    vm.restore(saved);
    vm.stop();
    assert.equal(vm.state, 'terminated');
    assert.equal(vm.frames.length, 0);
  }
});

test('numeric constants survive captured locals, method arguments and returned values', () => {
  const source = `using System;
    class Program {
      static long Step(long value) => value + 1;
      static void Main() { uint x = uint.MaxValue; Func<uint> read = () => x;
        Console.WriteLine(read()); Console.WriteLine(Step(int.MaxValue)); }
    }`;
  const result = compileToIL(source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  for (const vm of engines(result)) assert.equal(vm.run().output, '4294967295\n2147483648\n');
});

test('scalar static and instance fields start with typed defaults', () => {
  const result = compileToIL(`using System; class Program {
    static decimal Amount; static long Total; float Ratio;
    static void Main() { var value = new Program(); Amount += 0.1m; Total++;
      Console.WriteLine(Amount); Console.WriteLine(Total); Console.WriteLine(value.Ratio); }
  }`);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  for (const vm of engines(result)) assert.equal(vm.run().output, '0.1\n1\n0\n');
});

test('source numeric diagnostics and bytecode mode validation reject invalid combinations', () => {
  for (const body of ['decimal d = 1m; double x = 1; Console.WriteLine(d + x);', 'ulong x = 1; Console.WriteLine(-x);']) {
    const result = compile(`using System; class P { static void Main() { ${body} } }`);
    assert.equal(result.success, false);
    assert(result.diagnostics.some(diagnostic => ['CS0019', 'CS0023'].includes(diagnostic.code)));
  }
  const {image} = artifact('long x = 2; Console.WriteLine(x * x);');
  const method = image.methods.find(method => Array.from(method.code).some((word, index) =>
    index % 3 === 0 && word === Op.BINARY && method.code[index + 2] === numericMode('long')));
  const offset = Array.from(method.code).findIndex((word, index) => index % 3 === 0 && word === Op.BINARY);
  method.code[offset + 1] = Binary['&'];
  method.code[offset + 2] = numericMode('double');
  assert(verifyImage(image).some(error => error.includes('Invalid binary mode')));
  assert.equal(NumericType.int, 0);
  assert.equal(NumericType.double, 1);
  assert.equal(Op.CONVERT, 25);
});

test('source images reject malformed scalar wire values before creating a VM', () => {
  const {image} = artifact('long x = 2; Console.WriteLine(x);');
  const scalar = image.constants.findIndex(value => value?.scalar === 'long');
  image.constants[scalar] = {scalar: 'long', value: '9223372036854775808'};
  assert(verifyImage(image).some(error => error.includes('Invalid scalar constant')));
  assert.throws(() => new VirtualMachine(image), /Invalid scalar constant/);
});

for (const [name, source] of [
  ['generic receiver', 'Console.WriteLine(new A<int>().Get(42)); class A<T> { public T Get(T value) => value; }'],
  ['init property', 'Console.WriteLine(new A { X = 42 }.X); class A { public int X { get; init; } }'],
]) test(`profile Console fallback executes ${name} through semantic lowering`, () => {
  const result = compileToIL(source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  for (const vm of engines(result)) {
    const actual = vm.run();
    assert.equal(actual.state, 'terminated', actual.fault?.stack);
    assert.equal(actual.output, '42\n');
  }
});
