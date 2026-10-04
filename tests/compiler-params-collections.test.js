import test from 'node:test';
import assert from 'node:assert/strict';
import { runOnBothBackEnds, errorsOf, codesOf } from './compiler-modern-run.js';

// SF-A02-T81: C# 13 params collections and OverloadResolutionPriorityAttribute. The Roslyn-pinned programs are the
// `params-collections` and `overload-resolution-priority` fixtures of packages/compiler/test/differential.

const program = (members, body, types = '') =>
  `using System; using System.Collections.Generic; using System.Runtime.CompilerServices; ${types} ` +
  `class Program { ${members} static void Main() { ${body} } }`;
const run = (members, body, types) => runOnBothBackEnds(program(members, body, types));
const errors = (members, body, types, options) => errorsOf(program(members, body, types), options);

test('A02-T81 params List<T>: expanded, empty and normal form', () => {
  const members = 'static string Join(string sep, params List<int> xs) { string r = ""; foreach (var x in xs) r += x + sep; return r; }';
  assert.equal(run(members, 'Console.WriteLine(Join("-", 1, 2, 3) + "|" + Join("-") + "|" + Join("+", new List<int> { 9 }));'), '1-2-3-||9+\n');
});

test('A02-T81 the elements are evaluated in order, once, before the call', () => {
  const members =
    'static int Next(int v) { Console.WriteLine("next " + v); return v; } static int Sum(params List<int> xs) { Console.WriteLine("sum"); return xs.Count; }';
  assert.equal(run(members, 'Console.WriteLine(Sum(Next(1), Next(2)));'), 'next 1\nnext 2\nsum\n2\n');
});

test('A02-T81 other collection types and member kinds: HashSet<T>, generic method, constructor, indexer, delegate', () => {
  const types =
    'delegate int Counter(params List<int> xs); class Box { public int N; public Box(params List<string> names) { N = names.Count; } ' +
    'public int this[params List<int> keys] { get { return keys.Count; } } }';
  const members = 'static int Distinct(params HashSet<int> xs) { return xs.Count; } static int Count<T>(params List<T> xs) { return xs.Count; }';
  assert.equal(run(members, 'Console.WriteLine(Distinct(1, 1, 2) + Count("a", "b", "c"));', types), '5\n');
  assert.equal(run(members, 'Counter c = xs => xs.Count; Console.WriteLine(new Box("a", "b").N + new Box()[1, 2, 3] + c(1));', types), '6\n');
});

test('A02-T81 better collection: the type that converts to the other wins, then the better element conversion', () => {
  const members =
    'static string P(params IEnumerable<int> xs) { return "enumerable"; } static string P(params List<int> xs) { return "list"; } ' +
    'static string Q(params IEnumerable<int> xs) { return "enumerable"; } static string Q(params int[] xs) { return "array"; } ' +
    'static string S(params List<double> xs) { return "double"; } static string S(params List<int> xs) { return "int"; }';
  assert.equal(run(members, 'Console.WriteLine(P(1) + Q(1) + S(1) + S(1.5));'), 'listarrayintdouble\n');
});

test('A02-T81 List<T> against T[] and IList<T> against IReadOnlyList<T> are ambiguous: CS0121', () => {
  const members =
    'static void Pick(params List<int> xs) { } static void Pick(params int[] xs) { } ' +
    'static void R(params IList<int> xs) { } static void R(params IReadOnlyList<int> xs) { }';
  assert.deepEqual(errors(members, 'Pick(1); R(1);'), ['CS0121:Pick', 'CS0121:R']);
});

test('A02-T81 a non-params overload in normal form is better than an expanded one', () => {
  const members = 'static string Over(int a, params List<int> xs) { return "params"; } static string Over(int a, int b) { return "exact"; }';
  assert.equal(run(members, 'Console.WriteLine(Over(1, 2) + Over(1) + Over(1, 2, 3));'), 'exactparamsparams\n');
});

test('A02-T81 is gated: CS9202 below C# 13 on the parameter; arrays are not affected', () => {
  const members = 'static int Len(params List<string> xs) { return 0; } static int A(params int[] xs) { return 0; }';
  assert.deepEqual(errors(members, '', '', { langVersion: '12' }), ['CS9202:params List<string> xs']);
  assert.deepEqual(errors(members, '', '', { langVersion: '13' }), []);
});

test('A02-T81 parameter type rules: CS0225, CS1729, CS0117, CS9228', () => {
  const types =
    'class NoAdd : System.Collections.IEnumerable { public System.Collections.IEnumerator GetEnumerator() { return null; } } ' +
    'class NoCtor : List<int> { public NoCtor(int x) { } }';
  const members = 'static void A(params int x) { } static void B(params string s) { } static void D(params NoAdd n) { } static void E(params NoCtor n) { }';
  assert.deepEqual(errors(members, '', types), ['CS0225:params', 'CS1729:params string s', 'CS0117:params NoAdd n', 'CS9228:params NoCtor n']);
});

test('A02-T81 an element that does not convert is CS1503 on that argument', () => {
  assert.deepEqual(errors('static int Len(params List<string> xs) { return 0; }', 'Len(1);'), ['CS1503:1']);
});

test('A02-T81 OverloadResolutionPriority: the highest priority among the applicable members of one type', () => {
  const types =
    'class C { [OverloadResolutionPriority(1)] public static string M(object o) { return "object"; } public static string M(string s) { return "string"; } ' +
    'public static string K(int a) { return "exact"; } [OverloadResolutionPriority(5)] public static string K(string s) { return "string"; } ' +
    '[OverloadResolutionPriority(1)] public int this[object o] { get { return 1; } } public int this[string s] { get { return 2; } } }';
  assert.equal(run('', 'Console.WriteLine(C.M("x") + C.K(1) + new C()["k"]);', types), 'objectexact1\n');
});

test('A02-T81 OverloadResolutionPriority does not compare members of different types', () => {
  const types =
    'class C { } static class F { public static string Y(this C c, string s) { return "F string"; } } ' +
    'static class G { [OverloadResolutionPriority(1)] public static string Y(this C c, object o) { return "G object"; } }';
  assert.equal(run('', 'Console.WriteLine(new C().Y("s"));', types), 'F string\n');
});

test('A02-T81 OverloadResolutionPriority: CS9202 below C# 13, CS9261 on overrides, CS9262 where it has no meaning', () => {
  const gated = 'class C { [OverloadResolutionPriority(1)] public static void M(object o) { } }';
  assert.deepEqual(errors('', '', gated, { langVersion: '12' }), ['CS9202:OverloadResolutionPriority(1)']);
  const types =
    'class B { public virtual void V() { } } class D : B { [OverloadResolutionPriority(1)] public override void V() { } ' +
    '[OverloadResolutionPriority(2)] public int Q { get { return 0; } } [OverloadResolutionPriority(3)] static D() { } }';
  assert.deepEqual(errors('', '', types), ['CS9261:OverloadResolutionPriority(1)', 'CS9262:OverloadResolutionPriority(2)', 'CS9262:OverloadResolutionPriority(3)']);
});

test('A02-T81 limits are reported, not miscompiled: spans and collection interfaces the runtime does not have', () => {
  const span = 'static int Sum(params ReadOnlySpan<int> xs) { int s = 0; foreach (var x in xs) s += x; return s; }';
  assert(codesOf(program(span, 'Console.WriteLine(Sum(1, 2));')).includes('SF2200'));
  const readOnly = 'static int Count(params IReadOnlyList<int> xs) { return xs.Count; }';
  assert(codesOf(program(readOnly, 'Console.WriteLine(Count(1, 2));')).some(code => code.startsWith('SF')));
});
