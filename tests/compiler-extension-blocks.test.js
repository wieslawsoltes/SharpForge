import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { runOnBothBackEnds, errorsOf, codesOf } from './compiler-modern-run.js';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// SF-A02-T83: C# 14 extension blocks. The Roslyn-pinned programs are the `extension-blocks` fixtures of
// packages/compiler/test/differential; these tests cover each member kind on its own, the symbol shape and the limits.

const program = (extensions, body, types = '') =>
  `using System; using System.Collections.Generic; ${types} static class E { ${extensions} } class Program { static void Main() { ${body} } }`;
const run = (extensions, body, types) => runOnBothBackEnds(program(extensions, body, types));
const errors = (extensions, body, types, options) => errorsOf(program(extensions, body, types), options);

test('A02-T83 instance extension methods and properties on a predefined type', () => {
  const block = 'extension(string s) { public int Twice => s.Length * 2; public string Rep(int n) { string r = ""; while (n-- > 0) r += s; return r; } }';
  assert.equal(run(block, 'Console.WriteLine("abc".Twice); Console.WriteLine("ab".Rep(2));'), '6\nabab\n');
});

test('A02-T83 static extension members are reached through the extended type', () => {
  const block = 'extension(int) { public static int Zero => 0; public static int Twice(int x) { return x * 2; } }';
  assert.equal(run(block, 'Console.WriteLine(int.Zero + int.Twice(4));'), '8\n');
});

test('A02-T83 the implementation methods are ordinary static members of the class', () => {
  const block = 'extension(string s) { public int Twice => s.Length * 2; public string Tag() => "<" + s + ">"; public static string Make() => "made"; }';
  assert.equal(run(block, 'Console.WriteLine(E.get_Twice("ab") + E.Tag("x") + E.Make());'), '4<x>made\n');
});

test('A02-T83 symbols: static implementations with the block type parameters first', () => {
  const source = 'class Box<T> { } static class E { extension<T>(Box<T> box) { public U Map<U>(U u) => u; public int P => 1; public static int S() => 0; } }';
  const file = parse(new SourceText(source, 'Program.cs')),
    result = analyze([file]),
    type = result.assembly.types.find(t => t.name === 'E'),
    shape = name => {
      const method = type.getMembers(name)[0];
      return `${method.isStatic} <${method.typeParameters.map(p => p.name)}> (${method.parameters.map(p => p.name)}) ${method.isExtensionMethod}`;
    };
  assert.deepEqual(result.diagnostics.filter(d => d.severity === 'error'), []);
  assert.equal(shape('Map'), 'true <T,U> (box,u) true');
  assert.equal(shape('get_P'), 'true <T> (box) false');
  assert.equal(shape('S'), 'true <T> () false');
  assert.deepEqual(type.extensionMembers.map(entry => `${entry.kind}:${entry.name}`), ['instance:Map', 'instance:P', 'static:S']);
  // The property is not a member of the class: `E.P` does not find it.
  assert.equal(type.getMembers('P').length, 0);
});

test('A02-T83 generic blocks: the type arguments come from the receiver', () => {
  const types = 'class Box<T> { public T V; }';
  const block =
    'extension<T>(Box<T> box) { public T Value { get { return box.V; } set { box.V = value; } } public U Map<U>(Func<T, U> f) => f(box.V); ' +
    'public static Box<T> Of(T v) { return new Box<T> { V = v }; } } extension<T>(T[] items) { public T First0 => items[0]; }';
  assert.equal(run(block, 'var b = new Box<int>(); b.Value = 4; Console.WriteLine(b.Map(x => x + 1));', types), '5\n');
  assert.equal(run(block, 'Console.WriteLine(Box<string>.Of("s").Value + new[] { 7 }.First0);', types), 's7\n');
});

test('A02-T83 an extension property is read and written like a property: compound, increment, ??=, initializer', () => {
  const types = 'class Box<T> { public T V; public int Reads; }';
  const block = 'extension<T>(Box<T> box) { public T Value { get { box.Reads++; return box.V; } set { box.V = value; } } }';
  assert.equal(run(block, 'var b = new Box<int>(); b.Value += 4; b.Value++; Console.WriteLine(b.V + " " + b.Reads);', types), '5 2\n');
  assert.equal(run(block, 'var s = new Box<string>(); s.Value ??= "a"; s.Value ??= "b"; Console.WriteLine(s.V);', types), 'a\n');
  assert.equal(run(block, 'var b = new Box<int> { Value = 5 }; Console.WriteLine(b.V);', types), '5\n');
});

test('A02-T83 extension operators apply when the type has none', () => {
  const types = 'class Money { public int Cents; public Money(int c) { Cents = c; } }';
  const block =
    'extension(Money m) { public static Money operator +(Money a, Money b) => new Money(a.Cents + b.Cents); ' +
    'public static Money operator -(Money a) => new Money(-a.Cents); public static Money operator ++(Money a) => new Money(a.Cents + 1); }';
  assert.equal(run(block, 'var a = new Money(5); a += new Money(2); a++; Console.WriteLine((-a).Cents);', types), '-8\n');
  // A predefined operator is not replaced by an extension operator.
  assert.equal(run('extension(int) { public static int operator +(int a, int b) => 100; }', 'Console.WriteLine(1 + 2);'), '3\n');
});

test('A02-T83 a member of the type wins; a nearer or more specific extension wins', () => {
  const types = 'class Item { public int Size => 1; }';
  assert.equal(run('extension(Item i) { public int Size => 99; }', 'Console.WriteLine(new Item().Size);', types), '1\n');
  const block = 'extension(object o) { public string Kind => "object"; } extension(string s) { public string Kind => "string"; }';
  assert.equal(run(block, 'Console.WriteLine("s".Kind + 1.Kind);'), 'stringobject\n');
});

test('A02-T83 iterators, lambdas and other extension members inside an extension member', () => {
  const block =
    'extension(int n) { public IEnumerable<int> UpTo() { for (int i = 0; i < n; i++) yield return i; } ' +
    'public Func<int> Adder(int k) { return () => n + k; } public int Twice => n * 2; public int Four() => n.Twice.Twice; }';
  assert.equal(run(block, 'foreach (var i in 3.UpTo()) Console.Write(i); Console.WriteLine(2.Adder(5)() + 1.Four());'), '01211\n');
});

test('A02-T83 is a C# 14 feature', () => {
  const block = 'extension(string s) { public int Twice => s.Length * 2; }';
  assert.notDeepEqual(errors(block, 'Console.WriteLine("a".Twice);', '', { langVersion: '13' }), []);
  assert.deepEqual(errors(block, 'Console.WriteLine("a".Twice);', '', { langVersion: '14' }), []);
});

test('A02-T83 declaration rules', () => {
  assert.deepEqual(errors('extension(string s) { public int Auto { get; set; } class N { } }', ''), ['CS9282:Auto', 'CS9282:N']);
  assert.deepEqual(errors('extension(string s) { protected int P => 1; public int I { get => 1; init { } } public int String => 1; }', ''), [
    'CS9302:P',
    'CS9304:init',
    'CS9326:String',
  ]);
  assert.deepEqual(errors('extension(int) { public int Inst => 1; } extension(string a, string b) { }', ''), ['CS9303:Inst', 'CS9285:string b']);
  assert.deepEqual(errors('extension<T>(string s) { public int Under => 1; } extension(ref string r) { public int R => 1; }', ''), [
    'CS9295:Under',
    'CS9300:string',
  ]);
  assert.deepEqual(errors('extension(string s) { public static int Bad => s.Length; }', ''), ['CS9347:s']);
  assert.deepEqual(errorsOf('class C { extension(string s) { public int A => 1; } } class Program { static void Main() { } }'), ['CS9283:extension']);
});

test('A02-T83 use rules: ambiguity, static through a value, instance through a type, nameof, read-only', () => {
  const block =
    'extension(string s) { public int Twice => s.Length; public static int Zero => 0; public int A => 1; } } static class F { extension(string s) { public int A => 2; }';
  assert.deepEqual(errors(block, 'var x = "a".A;'), ['CS9339:"a".A']);
  assert.deepEqual(errors(block, 'var x = "a".Zero;'), ['CS0176:"a"']);
  assert.deepEqual(errors(block, 'var x = string.Twice;'), ['CS0120:string']);
  assert.deepEqual(errors(block, 'var x = nameof(string.Zero);'), ['CS9316:string.Zero']);
  assert.deepEqual(errors(block, '"a".Twice = 3;'), ['CS0200:"a".Twice']);
  assert.deepEqual(errors(block, 'var x = "a".Missing;'), ['CS1061:Missing']);
});

test('A02-T83 operator rules', () => {
  const types = 'class Money { }';
  assert.deepEqual(errors('extension(Money m) { public static int operator +(int a, int b) => 1; static Money operator -(Money a) => a; }', '', types), [
    'CS9319:+',
    'CS0558:-',
  ]);
  const twice = 'extension(Money m) { public static Money operator %(Money a, Money b) => a; } } static class F { extension(Money m) { public static Money operator %(Money a, Money b) => b; }';
  assert.deepEqual(errors(twice, 'var a = new Money(); var b = a % a;', types), ['CS9342:%']);
});

test('A02-T83 limits are reported, not miscompiled', () => {
  // Over a framework generic type an extension property runs; an extension method call does not yet, like a classic
  // generic extension method over List<T> (framework generics).
  const list = 'extension<T>(List<T> list) { public bool IsEmpty1 => list.Count == 0; public void AddTwice(T item) { list.Add(item); list.Add(item); } }';
  assert.equal(run(list, 'Console.WriteLine(new List<int>().IsEmpty1);'), 'True\n');
  assert(codesOf(program(list, 'new List<int>().AddTwice(3);')).some(code => code.startsWith('SF')));
  // Instance (compound assignment) operators in an extension block are not bound: the use is an error, never a wrong call.
  const types = 'class Acc { public int V; }';
  assert.deepEqual(errors('extension(Acc a) { public void operator +=(int x) { a.V += x; } }', 'var a = new Acc(); a += 1;', types), ['CS0019:a += 1']);
});
