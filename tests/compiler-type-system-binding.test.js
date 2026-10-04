import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { dumpSemanticTree } from '../packages/compiler/src/bound/semantic-dump.js';
import { mapArguments, buildCallPlan } from '../packages/compiler/src/overload/arguments.js';
import { RefSafety, EscapeScope } from '../packages/compiler/src/flow/ref-safety.js';
import { initializationOrder, staticInitializationOrder, isBeforeFieldInit } from '../packages/compiler/src/binder/constructors.js';
import { methodImplRows } from '../packages/compiler/src/binder/interface-impl.js';
import { erasurePlan, methodSpecBlob, typeSpecBlob, ElementType } from '../packages/compiler/src/codegen/generics.js';
import { checkSemanticFeature } from '../packages/compiler/src/binder/feature-check.js';
import { coreTypes } from '../packages/compiler/src/symbols/core-types.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { semanticRow } from '../packages/compiler/test/differential/tools/semantic-report.mjs';

const run = (source, options) => analyze([parse(new SourceText(source, 'a.cs'))], options);
const codes = (source, options) =>
  run(source, options)
    .diagnostics.map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`)
    .sort();
const errorCodes = (source, options) =>
  run(source, options)
    .diagnostics.filter(d => d.severity === 'error')
    .map(d => d.code)
    .sort();
const typeNamed = (result, name) => result.assembly.types.find(type => type.name === name);

test('A02-E01 the semantic analysis matches Roslyn on the pinned corpus and never rejects a valid program', () => {
  // The analysis binds against the framework registry here; programs for the real class library have their own axis.
  const fixtures = loadFixtures().filter(fixture => !fixture.referencesOnly);
  const pinned = loadPinned().results;
  let matched = 0;
  const falsePositives = [];
  for (const fixture of fixtures) {
    const row = semanticRow(fixture, pinned.get(fixture.id));
    assert.equal(row.crash, undefined, `${fixture.id}: ${row.crash}`);
    if (row.ok) matched++;
    const hasFalseError = fixture.kind === 'output' && row.details.some(d => d.severity === 'error' && d.unexpected.length);
    if (hasFalseError) falsePositives.push(fixture.id);
  }
  assert.deepEqual(falsePositives, [], 'valid programs with errors from the semantic analysis');
  // 463 of 524 fixtures had exactly Roslyn's errors when this was written; the bound guards against regressions.
  assert(matched >= 455, `only ${matched} of ${fixtures.length} fixtures match Roslyn`);
});

test('A02-T02 generic declarations, substitution, constraints and inference', () => {
  const source = `
    class Box<T> { public T Value; public Box(T value) { Value = value; } public U Map<U>(U other) { return other; } }
    class Outer<T> { public class Inner<U> { public T First; public U Second; } }
    static class Util { public static T Pick<T>(T a, T b) { return a; } public static void Swap<T>(ref T a, ref T b) { T t = a; a = b; b = t; } }
    class P {
      static void Main() {
        var box = new Box<int>(1); int v = box.Value; string s = box.Map("x");
        var inner = new Outer<int>.Inner<string>(); int first = inner.First; string second = inner.Second;
        long picked = Util.Pick(1, 2L); int a = 1, b = 2; Util.Swap(ref a, ref b);
      }
    }`;
  assert.deepEqual(errorCodes(source), []);
  assert.deepEqual(errorCodes('class A<T> where T : struct { } class B { A<string> f; }'), ['CS0453']);
  assert.deepEqual(errorCodes('class A<T> where T : class, new() { } class N { N(int x) { } } class B { A<N> f; A<int> g; }'), [
    'CS0310',
    'CS0452',
  ]);
  assert.deepEqual(errorCodes('interface I { } class A<T> where T : I { } struct S { } class C { } class B { A<S> f; A<C> g; }'), [
    'CS0311',
    'CS0315',
  ]);
  assert.deepEqual(
    errorCodes('static class U { public static T Make<T>() { return default(T); } } class P { void M() { var x = U.Make(); } }'),
    ['CS0411'],
  );
  assert.deepEqual(errorCodes('class A<T> where U : class { }'), ['CS0699']);
  assert.deepEqual(errorCodes('interface I<out T> { void Put(T t); }'), ['CS1961']);
  assert.deepEqual(errorCodes('interface I<in T> { T Get(); }'), ['CS1961']);
  assert.deepEqual(errorCodes('class A<T> { } class B { A f; }'), ['CS0305']);
  assert.deepEqual(errorCodes('class A { } class B { A<int> f; }'), ['CS0308']);
});

test('A02-T03 inheritance, overrides, abstract members and interface implementation', () => {
  assert.deepEqual(errorCodes('class A : B { } class B : A { }'), ['CS0146', 'CS0146']);
  assert.deepEqual(errorCodes('sealed class A { } class B : A { }'), ['CS0509']);
  assert.deepEqual(errorCodes('abstract class A { public abstract void M(); } class B : A { }'), ['CS0534']);
  assert.deepEqual(errorCodes('class A { public void M() { } } class B : A { public override void M() { } }'), ['CS0506']);
  assert.deepEqual(errorCodes('class A { } class B : A { public override void M() { } }'), ['CS0115']);
  assert.deepEqual(errorCodes('class A { public virtual void M() { } } class B : A { protected override void M() { } }'), ['CS0507']);
  assert.deepEqual(errorCodes('interface I { void M(); int P { get; } } class C : I { }'), ['CS0535', 'CS0535']);
  assert.deepEqual(errorCodes('interface I { int M(); } class C : I { public void M() { } }'), ['CS0738']);
  assert.deepEqual(errorCodes('interface I { void M(); } class C : I { void M() { } }'), ['CS0737']);
  assert.deepEqual(codes('class A { public void M() { } } class B : A { public void M() { } }'), ['CS0108:M']);
  assert.deepEqual(codes('class A { public virtual void M() { } } class B : A { public void M() { } }'), ['CS0114:M']);
  const valid = run(`
    interface IShape { double Area(); string Name { get; } }
    interface INamed { string Name { get; } }
    abstract class Shape : IShape { public abstract double Area(); public virtual string Name { get { return "shape"; } } }
    class Circle : Shape, INamed { public override double Area() { return 3.0; } string INamed.Name { get { return "circle"; } } }
    class Base { public Base(int x) { } }
    class Derived : Base { int f = 1; static int s = 2; public Derived() : this(1) { } public Derived(int x) : base(x) { } }`);
  assert.deepEqual(
    valid.diagnostics.filter(d => d.severity === 'error'),
    [],
  );
  const circle = typeNamed(valid, 'Circle');
  const rows = methodImplRows(circle, circle.interfaceImplementations);
  assert(rows.some(row => row.body.name === 'INamed.get_Name'));
  const derived = typeNamed(valid, 'Derived');
  const parameterless = derived.getMembers('.ctor').find(c => c.parameters.length === 0);
  const order = initializationOrder(derived, parameterless, c => c.thisTarget ?? c.baseTarget ?? null).map(step => step.kind);
  // Derived() chains to Derived(int): its initializers, Base(int) (which calls object()), then the bodies innermost first.
  assert.deepEqual(order, ['thisCall', 'initializer', 'baseCall', 'baseCall', 'body', 'body', 'body']);
  assert.deepEqual(
    staticInitializationOrder(derived).map(step => step.symbol.name),
    ['s'],
  );
  assert.equal(isBeforeFieldInit(derived), true);
  assert.deepEqual(errorCodes('class A { public A(int x) { } } class B : A { }'), ['CS7036']);
});

test('A02-T04 structs, by-reference arguments, readonly and ref struct rules', () => {
  assert.deepEqual(errorCodes('struct A { B b; } struct B { A a; }').slice(0, 2), ['CS0523', 'CS0523']);
  const refs = `
    class H { public int P { get; set; } public readonly int R; }
    static class U { public static void Inc(ref int v) { v++; } public static void Get(out int v) { v = 1; } }
    class P { void M(H h, in int k) { int x = 0; U.Inc(ref x); U.Get(out int y); U.Inc(ref 5); U.Inc(ref h.P); U.Inc(x); U.Inc(ref h.R); U.Inc(ref k); } }`;
  assert.deepEqual(errorCodes(refs), ['CS0192', 'CS0206', 'CS1510', 'CS1620', 'CS8329']);
  assert.deepEqual(errorCodes('readonly struct P { public int X; }'), ['CS8340']);
  assert.deepEqual(errorCodes('ref struct R { } class C { R field; }'), ['CS8345']);
  assert.deepEqual(errorCodes('class C { static void M(out int v) { } }'), ['CS0177']);
  assert.deepEqual(errorCodes('struct P { public int X, Y; } class C { static int M() { P p; p.X = 1; return p.Y; } }'), ['CS0170']);
  assert.deepEqual(errorCodes('struct P { public int X, Y; } class C { static P M() { P p; p.X = 1; p.Y = 2; return p; } }'), []);
  assert.deepEqual(errorCodes('struct P { public int X; public P(int x) { } }', { langVersion: '10' }), ['CS0171']);
  assert.deepEqual(errorCodes('struct P { public int X; public P(int x) { } }'), []);
  assert.deepEqual(errorCodes('class C { int f; ref int M() { int x = 0; return ref x; } ref int N() { return ref f; } }'), ['CS8168']);
  const safety = new RefSafety();
  const span = { isRefLikeType: true, toDisplayString: () => 'Span<int>' };
  const local = { name: 's', type: span, refKind: 'none' };
  safety.declareLocal(local, 0);
  safety.initializeLocal(local, { kind: 'StackAlloc', type: span });
  assert.equal(safety.safeContext({ kind: 'Local', local, type: span }), EscapeScope.CurrentMethod);
  assert.deepEqual(safety.checkReturn({ kind: 'Local', local, type: span }), { code: 'CS8352', args: ['s'] });
  assert.equal(safety.checkReturn({ kind: 'Parameter', parameter: { name: 'p', type: span, refKind: 'none' }, type: span }), null);
  assert.deepEqual(safety.checkRefReturn({ kind: 'Local', local }), { code: 'CS8168', args: ['s'] });
});

test('A02-T05 nullable value conversions, null-conditional access and the nullable flow walker', () => {
  assert.deepEqual(errorCodes('class C { void M() { int? a = 5; int b = a; int c = null; long? d = a; int e = (int)a; } }'), [
    'CS0037',
    'CS0266',
  ]);
  // SF-A02-B03: `s?.Length` is an expression of type int?.
  const result = run('class C { static int? M(string s) { return s?.Length; } }');
  assert.deepEqual(result.diagnostics, []);
  const method = typeNamed(result, 'C').getMembers('M')[0];
  const dump = dumpSemanticTree(result.bound.get(method)).join('\n');
  assert.match(
    dump,
    /ConditionalAccess isLifted=true : int\?\n\s+Parameter parameter=s : string\n\s+PropertyAccess property=string\.Length : int/,
  );
  const nullable = `#nullable enable
    class C {
      string name; string? nick;
      public C() { }
      int Len(string? s) { return s.Length; }
      int Safe(string? s) { if (s == null) return 0; return s.Length; }
      string Pick(string? s) { string t = s; nick = null; name = null; return nick; }
      int Unbox(object? o) { return (int)o; }
      string Forgive(string? s) { return s!; }
    }`;
  const warnings = codes(nullable).map(text => text.split(':')[0]);
  assert.deepEqual(warnings.filter(code => code.startsWith('CS86')).sort(), ['CS8600', 'CS8602', 'CS8603', 'CS8605', 'CS8618', 'CS8625']);
  // Without a nullable context the flow warnings are gone; each `?` annotation is CS8632, as in Roslyn.
  const withoutContext = codes(nullable.replace('#nullable enable', '')).filter(text => text.startsWith('CS86'));
  assert.deepEqual([...new Set(withoutContext.map(text => text.split(':')[0]))], ['CS8632']);
  assert.equal(withoutContext.length, 6);
  const overrides = `#nullable enable
    class B { public virtual string F(string? a) { return ""; } }
    class D : B { public override string? F(string a) { return a; } }`;
  // Roslyn reports one mismatch per member, the return type first (pinned: nullable-references/overrides-and-implementations-...).
  assert.deepEqual(codes(overrides), ['CS8764:F']);
});

test('A02-T06 overload resolution, named and optional arguments, user conversions, operators and extension methods', () => {
  const overloads = `
    static class U {
      public static string F(int a) { return "int"; } public static string F(long a) { return "long"; } public static string F(object a) { return "object"; }
      public static void G(int a, long b) { } public static void G(long a, int b) { }
      public static void H(int a, int b = 2, params int[] rest) { }
    }
    class P { void M() { U.F(1); U.F(1L); U.F("s"); U.G(1, 2); U.H(1); U.H(b: 3, a: 1); U.H(1, 2, 3, 4); U.H(); U.H(1, c: 2); U.F(); } }`;
  assert.deepEqual(errorCodes(overloads), ['CS0121', 'CS1501', 'CS1739', 'CS7036']);
  const conversions = `
    struct M { public static implicit operator M(int v) { return new M(); } public static explicit operator int(M m) { return 0; } }
    struct V { public static V operator +(V a, V b) { return a; } }
    class P { void F() { M m = 5; int i = (int)m; int bad = m; V v = new V(); V w = v + v; V x = v - v; } }`;
  assert.deepEqual(errorCodes(conversions), ['CS0019', 'CS0266']);
  const extensions = `
    namespace Lib { public static class E { public static int Twice(this int x) { return x * 2; } } }
    namespace App { using Lib; class P { int M() { return 2.Twice(); } } }`;
  assert.deepEqual(errorCodes(extensions), []);
  const groups = `
    delegate int Op(int a, int b);
    static class U { public static int Add(int a, int b) { return a + b; } public static int Neg(int a) { return -a; } }
    class P { void M() { Op ok = U.Add; Op bad = U.Neg; int n = U.Add; } }`;
  assert.deepEqual(errorCodes(groups), ['CS0123', 'CS0428']);
  const parameters = [{ name: 'a' }, { name: 'b', isOptional: true }, { name: 'rest', isParams: true, type: { elementType: 'int' } }];
  const fixed = parameters.slice(0, 2);
  const mapping = mapArguments(fixed, [{ name: 'b' }, { name: 'a' }]);
  assert.deepEqual(mapping.parameterOf, [1, 0]);
  const plan = buildCallPlan(mapping, fixed, [{}, {}]);
  assert.equal(plan.needsTemps, true);
  assert.deepEqual(
    plan.evaluation.map(step => step.parameter),
    [1, 0],
  );
  assert.equal(mapArguments(parameters, [{}, {}, {}, {}], { expanded: true }).paramsCount, 2);
  assert.equal(mapArguments(parameters, []).error.code, 'CS7036');
  assert.equal(mapArguments(parameters.slice(0, 2), [{}, {}, {}]).error.code, 'CS1501');
});

test('A02-T02.6 generic signatures and the erasure plan of the bytecode profile', () => {
  const core = coreTypes();
  const tokens = new Map([
    [core.ienumerableT, 0x01000005],
    [core.nullable, 0x01000006],
  ]);
  const tokenOf = definition => tokens.get(definition);
  const blob = typeSpecBlob(core.ienumerableT.construct(core.string), tokenOf);
  assert.deepEqual([...blob], [ElementType.GenericInst, ElementType.Class, (5 << 2) | 1, 1, ElementType.String]);
  assert.deepEqual(
    [...typeSpecBlob(core.nullableOf(core.int), tokenOf)],
    [ElementType.GenericInst, ElementType.ValueType, (6 << 2) | 1, 1, ElementType.I4],
  );
  assert.deepEqual([...typeSpecBlob(core.arrayOf(core.int), tokenOf)], [ElementType.SZArray, ElementType.I4]);
  const result = run(
    'static class U { public static T Id<T>(T x) { return x; } public static T Zero<T>() { return default(T); } } class P { int M() { return U.Id(1); } }',
  );
  const util = typeNamed(result, 'U');
  const id = util.getMembers('Id')[0];
  const zero = util.getMembers('Zero')[0];
  assert.deepEqual(erasurePlan(id, result.bound.get(id)), { executable: true, needs: [] });
  assert.equal(erasurePlan(zero, result.bound.get(zero)).executable, false);
  assert.deepEqual([...methodSpecBlob(id.construct(core.int), tokenOf)], [0x0a, 1, ElementType.I4]);
});

test('A02-B01 semantic features are gated with the shared catalog', () => {
  assert.equal(checkSemanticFeature('asyncMain', '7').code, 'CS8107');
  assert.equal(checkSemanticFeature('asyncMain', '7.1'), null);
  assert.equal(checkSemanticFeature('covariantReturns', '8').code, 'CS8400');
  // Roslyn reports static abstract interface members below C# 11 as "the modifier 'abstract' is not valid" (CS8703).
  assert.equal(checkSemanticFeature('staticAbstractMembers', '10').code, 'CS8703');
  assert.deepEqual(errorCodes('interface I { void M() { } }', { langVersion: '7.3' }), ['CS8370']);
  assert.deepEqual(
    errorCodes('class A { public virtual object F() { return null; } } class B : A { public override string F() { return null; } }', {
      langVersion: '8',
    }),
    ['CS8400'],
  );
});

test('A02-E01 compile(): Roslyn diagnostics for invalid programs, SF2200 for valid programs the profile cannot run', () => {
  const invalid = compile('using System; Color c = 1; Console.WriteLine(c); enum Color { Red }');
  assert.equal(invalid.success, false);
  assert.deepEqual(
    invalid.diagnostics.filter(d => d.code.startsWith('CS')).map(d => d.code),
    ['CS0266'],
  );
  assert.deepEqual(invalid.semantic, { analysed: true, complete: true });
  const valid = compile('struct P { public int X; } class Q { static void Main() { P p = new P(); p.X = 1; } }');
  assert.equal(valid.success, false);
  assert.equal(valid.image, null);
  const notExecutable = valid.diagnostics.find(d => d.code === 'SF2200');
  assert.match(notExecutable.message, /valid C# but is not executable on this runtime profile: it uses struct/);
  assert.equal(
    valid.diagnostics.some(d => /^CS/.test(d.code) && d.severity === 'error'),
    false,
  );
  // Programs inside the profile are untouched, in both pipelines.
  const plain = 'class P { static int Twice(int x) { return x * 2; } static void Main() { Console.WriteLine(Twice(21)); } }';
  assert.equal(compile(plain).semantic, undefined);
  assert.equal(compile(plain, { pipeline: 'verify' }).success, true);
});

test('A02-T20/T22 compile() binds against referenced assemblies', () => {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/metadata/MiniStandard.dll', import.meta.url)));
  const source =
    'using System; using System.Collections.Generic; struct S { } ' +
    'class P { static void Main() { Console.WriteLine("hi"); var l = new List<int>(); l.Add(1); l.Add("x"); Console.Nope(); } }';
  const result = compile(source, { references: [{ bytes }] });
  assert.deepEqual(
    result.diagnostics
      .filter(d => /^CS/.test(d.code))
      .map(d => d.code)
      .sort(),
    ['CS0117', 'CS1503'],
  );
  const ok = compile(source.replace(' l.Add("x"); Console.Nope();', ''), { references: [{ bytes }] });
  assert.deepEqual(
    ok.diagnostics.filter(d => /^CS/.test(d.code) && d.severity === 'error'),
    [],
  );
  assert(ok.diagnostics.some(d => d.code === 'SF2200'));
});
