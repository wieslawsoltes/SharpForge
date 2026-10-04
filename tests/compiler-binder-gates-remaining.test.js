/**
 * Language-version gates that need bound symbols (SF-A02-B01, hand-over of SF-A01-T01.3): the rows of the feature
 * catalog that only the binder can decide. Codes and spans of the matrix snippets are pinned against Roslyn in
 * packages/compiler/test/differential/fixtures/feature-gates.js; these tests cover the other positions a gate is
 * reported at, the boundaries, and what the features do once they are available.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf } from './support/semantic-codegen.js';

/** The C# errors of a program as `code@text`, where `text` is the source the diagnostic covers. */
const errors = (source, options) =>
  compile(source, options)
    .diagnostics.filter(d => d.severity === 'error' && d.code.startsWith('CS'))
    .map(d => `${d.code}@${source.slice(d.start, d.start + d.length)}`);

test('unmanaged constructed types are gated at every position Roslyn reports (C# 8)', () => {
  const source = `struct Pair<T> { public T A; }
unsafe class A {
  Pair<int>* f;
  static Pair<int>* M(Pair<int>* p) { Pair<int>* q = p; int n = sizeof(Pair<int>); Pair<int> v = default(Pair<int>); var r = &v; return q; }
  Pair<int>*[] P { get { return null; } }
  static void G<T>() where T : unmanaged { }
  static void H() { G<Pair<int>>(); }
}
class Program { static void Main() { } }
`;
  const gated = ['f', 'M', 'p', 'Pair<int>*', 'sizeof(Pair<int>)', '&v', 'P', 'G<Pair<int>>'].map(text => `CS8370@${text}`);
  assert.deepEqual(errors(source, { langVersion: '7.3', allowUnsafe: true }), gated);
  assert.deepEqual(errors(source, { langVersion: '8', allowUnsafe: true }), []);
  // A struct that is not constructed, and a constructed one with a managed field, are not this feature.
  const other = `struct Plain { public int A; } struct Box<T> { public T A; }
unsafe class A { static void M(Plain* p, int* q) { } static void N() { Box<string> b = default(Box<string>); } }
class Program { static void Main() { } }
`;
  assert.deepEqual(errors(other, { langVersion: '7.3', allowUnsafe: true }), []);
});

test('fixed over GetPinnableReference and indexing a moveable fixed buffer need C# 7.3', () => {
  const source = `class Pin { public ref int GetPinnableReference() { throw null; } }
class NoPin { public int GetPinnableReference() { return 0; } }
unsafe struct S { public fixed int Data[4]; }
unsafe class A {
  static S s;
  static void M(Pin p, NoPin n) { fixed (int* q = p) { } fixed (int* r = n) { } }
  static int N(S local) { return s.Data[0] + local.Data[1]; }
}
class Program { static void Main() { } }
`;
  // A method that does not return by reference is not the pattern at any version; a buffer of a local is fixed already.
  assert.deepEqual(errors(source, { langVersion: '7.2', allowUnsafe: true }), ['CS8320@p', 'CS8385@n', 'CS8320@s.Data']);
  assert.deepEqual(errors(source, { langVersion: '7.3', allowUnsafe: true }), ['CS8385@n']);
});

test('pattern gates: null for a pointer (C# 8), a string constant for a span of char (C# 11)', () => {
  const pointer = 'class Program { static unsafe bool M(int* p, object o) { return p is null || o is null; } static void Main() { } }\n';
  assert.deepEqual(errors(pointer, { langVersion: '7.3', allowUnsafe: true }), ['CS8370@null']);
  assert.deepEqual(errors(pointer, { langVersion: '8', allowUnsafe: true }), []);
  const span = `class Program {
  static bool M(System.ReadOnlySpan<char> s, System.Span<char> t) { return s is "text" || t is "x"; }
  static bool N(System.ReadOnlySpan<int> s) { return s is "text"; }
  static void Main() { }
}
`;
  assert.deepEqual(errors(span, { langVersion: '10' }), ['CS8936@"text"', 'CS8936@"x"', 'CS0029@"text"']);
  assert.deepEqual(errors(span, { langVersion: '11' }), ['CS0029@"text"']);
});

test('generic pattern matching below C# 7.1 is CS8314 unless the types convert', () => {
  const source = `class Base { }
class Derived : Base { }
class Program {
  static bool A<T>(T value) { return value is int i; }
  static bool B<T>(T value) where T : Base { return value is Derived d; }
  static int C<T>(T value) { switch (value) { case int n: return n; case string s: return 1; default: return 0; } }
  static bool D<T>(Base value) where T : Base { return value is T t; }
  static bool E<T>(object value) { return value is T t; }
  static bool F<T, U>(T value) { return value is U u; }
  static void Main() { }
}
`;
  assert.deepEqual(errors(source, { langVersion: '7' }), ['CS8314@int', 'CS8314@Derived', 'CS8314@int', 'CS8314@string', 'CS8314@U']);
  assert.deepEqual(errors(source, { langVersion: '7.1' }), []);
  const message = compile(source, { langVersion: '7' }).diagnostics.find(d => d.code === 'CS8314').message;
  assert.equal(
    message,
    "An expression of type 'T' cannot be handled by a pattern of type 'int' in C# 7.0. Please use language version 7.1 or greater.",
  );
});

test('attribute gates: [Obsolete] on a property accessor (C# 8), [MemberNotNull] (C# 9)', () => {
  const source = `using System.Diagnostics.CodeAnalysis;
class Program {
  static string name = "";
  [System.Obsolete] int Whole { get { return 1; } }
  int Part { [System.Obsolete("old")] get { return 1; } [System.Obsolete] set { } }
  [MemberNotNull("name")] static void Init() { name = ""; }
  static bool Ready { [MemberNotNullWhen(true, "name")] get { return name != null; } }
  static void Main() { }
}
`;
  assert.deepEqual(errors(source, { langVersion: '7.3' }), [
    'CS8370@System.Obsolete',
    'CS8370@System.Obsolete',
    'CS8370@MemberNotNull("name")',
    'CS8370@MemberNotNullWhen(true, "name")',
  ]);
  assert.deepEqual(errors(source, { langVersion: '8' }), ['CS8400@MemberNotNull("name")', 'CS8400@MemberNotNullWhen(true, "name")']);
  assert.deepEqual(errors(source, { langVersion: '9' }), []);
});

test('with on a struct or an anonymous type needs C# 10; a record does not', () => {
  const source = `struct S { public int X; }
record R(int X);
class Program {
  static S M(S s) { return s with { X = 1 }; }
  static R N(R r) { return r with { X = 1 }; }
  static void Main() { var a = new { X = 1 }; var b = a with { X = 2 }; }
}
`;
  assert.deepEqual(errors(source, { langVersion: '9' }), ['CS8773@s with { X = 1 }', 'CS8773@a with { X = 2 }']);
  assert.deepEqual(errors(source, { langVersion: '10' }), []);
});

test('with on an anonymous type makes a new instance; the receiver and the values are evaluated once, in order', () => {
  const source = `using System;
interface IMarker { }
class Program {
  static int N(int v) { Console.WriteLine(v); return v; }
  static void Main() {
    var a = new { X = 1, Y = "s" };
    var b = a with { Y = "t" + N(1), X = N(2) };
    Console.WriteLine(b.X + b.Y + a.X + a.Y);
    Console.WriteLine(a with { });
    Console.WriteLine(b.Equals(a) + " " + (a with { }).Equals(a));
  }
}
`;
  assert.deepEqual(linesOf(source), ['1', '2', '2t11s', '{ X = 1, Y = s }', 'False True']);
  const wrong = 'class Program { static void Main() { var a = new { X = 1 }; var c = a with { Z = 1 }; var d = a with { X = "no" }; } }\n';
  assert.deepEqual(errors(wrong), ['CS0117@Z', 'CS0029@"no"']);
});

test('await foreach over an extension GetAsyncEnumerator needs C# 9 and runs', () => {
  const source = `using System;
using System.Threading.Tasks;
class Bag { public int Count = 3; }
class Walker {
  int left; int current;
  public Walker(int count) { left = count; }
  public int Current => current;
  public async Task<bool> MoveNextAsync() { await Task.Yield(); if (left == 0) return false; current = left--; return true; }
  public async Task DisposeAsync() { await Task.Yield(); Console.WriteLine("disposed"); }
}
static class BagExtensions { public static Walker GetAsyncEnumerator(this Bag bag) => new Walker(bag.Count); }
class Program {
  static async Task Main() { await foreach (int x in new Bag()) Console.WriteLine(x); }
}
`;
  assert.deepEqual(errors(source, { langVersion: '8' }), ['CS8400@new Bag()']);
  assert.deepEqual(linesOf(source), ['3', '2', '1', 'disposed']);
  // Without the extension method the type is not asynchronously enumerable at any version.
  const none = source.replace(/static class BagExtensions[^\n]*\n/, '');
  assert.deepEqual(errors(none), ['CS8411@new Bag()']);
});

test('an implicit implementation of a non-public interface member is CS8704 below C# 10', () => {
  const source = `interface I { protected void M(); internal int P { get; } public void Q(); int R { get; protected set; } void X(); }
class A : I { public void M() { } public int P => 1; public void Q() { } public int R { get; set; } void I.X() { } }
class Program { static void Main() { } }
`;
  assert.deepEqual(errors(source, { langVersion: '9' }), ['CS8704@M', 'CS8704@1', 'CS8704@set']);
  assert.deepEqual(errors(source, { langVersion: '10' }), []);
  const message = compile(source, { langVersion: '9' }).diagnostics.find(d => d.code === 'CS8704').message;
  assert.match(message, /^'A' does not implement interface member 'I\.M\(\)'\. 'A\.M\(\)' cannot implicitly implement .* in C# 9\.0\./);
});

test('variance of static interface members is checked below C# 9 (CS8904) and never for instance members only', () => {
  const source = `interface I<out T, in U> {
  static void M(T t) { }
  static U N() { throw null; }
  static T Make() { throw null; }
  static U P { get { throw null; } }
  void Q(T t);
}
class Program { static void Main() { } }
`;
  assert.deepEqual(errors(source, { langVersion: '8' }), ['CS8904@T', 'CS8904@U', 'CS8904@U', 'CS1961@T']);
  assert.deepEqual(errors(source, { langVersion: '9' }), ['CS1961@T']);
});

test('expression trees: named and omitted optional arguments need C# 14', () => {
  const source = `using System;
using System.Linq.Expressions;
class Program {
  Program(int a = 1) { }
  static int M(int x = 1, int y = 2) { return x; }
  static Expression<Func<int>> e = () => M();
  static Expression<Func<int>> f = () => M(y: 2, x: 1);
  static Expression<Func<int>> g = () => M(x: 2, y: 1);
  static Expression<Func<int>> h = () => M(1, 2);
  static Expression<Func<Program>> n = () => new Program();
  static Func<int> plain = () => M(y: 2);
  static void Main() { }
}
`;
  assert.deepEqual(errors(source, { langVersion: '13' }), ['CS0854@M()', 'CS0853@M(y: 2, x: 1)', 'CS0853@M(x: 2, y: 1)', 'CS0854@new Program()']);
  assert.deepEqual(errors(source, { langVersion: '14' }), ['CS9307@M(y: 2, x: 1)']);
});
