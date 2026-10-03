import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { compile } from '@sharpforge/compiler';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { dynamicOperation } from '../packages/compiler/src/lowering/dynamic.js';
import { DynamicTypeSymbol } from '../packages/compiler/src/symbols/types.js';

// `dynamic` (SF-A02-T55). The Roslyn-pinned programs are the `dynamic` fixtures of packages/compiler/test/differential.

const members = `
  static int One(int x) { return x; }
  static int Twice(int x) { return x; }
  static string Twice(string x) { return x; }
  class Box { public Box(int v) { } public Box(string v) { } public int this[int i] { get { return i; } } }`;
const program = body => `using System; class P { ${members} static void Main() { dynamic d = 2; ${body} } }`;

function analysed(body) {
  const source = program(body),
    result = analyze([parse(new SourceText(source, 'Program.cs'))], {});
  assert.equal(result.incomplete, false, 'the analysis is complete');
  return result.diagnostics.filter(d => d.severity === 'error').map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
}

test('operations on a dynamic value are not checked: member, call, index, operators, conversions', () => {
  assert.deepEqual(analysed('var a = d.Missing; d.Nope(1, "x"); var b = d[0]; d[1] = 2; d(3); d.P = d.Q = 4;'), []);
  assert.deepEqual(analysed('var a = d + 1; var b = -d; var c = !d; d++; d += 2; var e = d == null; var f = d && d;'), []);
  assert.deepEqual(analysed('int i = d; string s = d; Box b = d; if (d) { } var t = d ? 1 : 2; var u = d as Box; var v = (Box)d;'), []);
  assert.deepEqual(analysed('foreach (var x in d) { x.Foo(); } using (d) { } var q = d?.Foo(1)?.Bar; var r = d ?? 1; r.Foo();'), []);
});

test('a dynamic argument defers the overload: an ambiguity is not an error and the result is dynamic', () => {
  assert.deepEqual(analysed('var a = Twice(d); a.Foo(); var b = One(d); b.Foo(); var c = new Box(1)[d]; c.Foo();'), []);
  // The class of a creation is known; an array element and a local function are bound statically.
  assert.deepEqual(analysed('var a = new Box(d); a.Foo();'), ['CS1061:Foo']);
  assert.deepEqual(analysed('int[] a = { 1 }; var e = a[d]; e.Foo();'), ['CS1061:Foo']);
  assert.deepEqual(analysed('int L(int x) => x; var a = L(d); a.Foo();'), ['CS1061:Foo']);
  // No candidate can apply: the usual error.
  assert.deepEqual(analysed('One(d, d);'), ['CS1501:One']);
});

test('the result of a late-bound operation converts like dynamic, then it is static again', () => {
  assert.deepEqual(analysed('int i = d.Foo(); i.Bar();'), ['CS1061:Bar']);
  assert.deepEqual(analysed('object o = d; o.Bar();'), ['CS1061:Bar']);
});

test('arguments of a dynamically dispatched operation', () => {
  assert.deepEqual(analysed('d.Foo(x => x);'), ['CS1977:x => x']);
  assert.deepEqual(analysed('d.Foo(Console.WriteLine);'), ['CS1976:Console.WriteLine']);
  assert.deepEqual(analysed('d.Foo(in d);'), ['CS8364:d']);
  assert.deepEqual(analysed('d.Foo(out var x);'), ['CS8197:x']);
  assert.deepEqual(analysed('d.Foo(default);'), ['CS8716:default']);
  assert.deepEqual(analysed('var a = d.Foo<int>;'), ['CS0307:Foo<int>']);
  assert.deepEqual(analysed('d.Foo((Action)(() => { }), null, "s", new[] { 1 });'), []);
});

test('the dynamic type itself: typeof, is, new, deconstruction', () => {
  assert.deepEqual(analysed('var t = typeof(dynamic);'), ['CS1962:typeof(dynamic)']);
  assert.deepEqual(analysed('var t = new dynamic();'), ['CS8386:dynamic']);
  assert.deepEqual(analysed('var (a, b) = d;').sort(), ['CS8130:a', 'CS8130:b', 'CS8133:d']);
  assert.deepEqual(analysed('var a = typeof(dynamic[]); var b = default(dynamic); var c = new dynamic[1]; var e = (dynamic)null;'), []);
});

test('code generation names the late-bound operation; statically bound nodes are not dynamic operations', () => {
  const dynamic = DynamicTypeSymbol.instance,
    int = { typeKind: 'struct', specialType: 'System_Int32' },
    object = { typeKind: 'class', specialType: 'System_Object' };
  assert.equal(dynamicOperation({ kind: 'DynamicInvocation', isDynamic: true }), 'an invocation');
  assert.equal(dynamicOperation({ kind: 'Binary', left: { type: int }, right: { type: dynamic } }), 'an operator');
  assert.equal(dynamicOperation({ kind: 'Binary', left: { type: int }, right: { type: int } }), null);
  assert.equal(dynamicOperation({ kind: 'Conversion', type: int, operand: { type: dynamic } }), 'a conversion');
  assert.equal(dynamicOperation({ kind: 'Conversion', type: object, operand: { type: dynamic } }), null);
  assert.equal(dynamicOperation({ kind: 'Conversion', type: dynamic, operand: { type: int } }), null);
});

test('a dynamic operation is SF2200 naming the missing binder; no false C# error, no image', () => {
  for (const [body, operation] of [
    ['var a = d.Length;', 'a member access'],
    ['d.Foo();', 'an invocation'],
    ['var a = d + 1;', 'an operator'],
    ['int i = d;', 'a conversion'],
    ['var a = d[0];', 'an element access'],
  ]) {
    const result = compile(program(body));
    const errors = result.diagnostics.filter(d => d.severity === 'error' && !/^SF1|^SF20/.test(d.code));
    assert.equal(result.success, false, body);
    assert.deepEqual(errors.map(d => d.code), ['SF2200'], body);
    assert.match(errors[0].message, new RegExp(`${operation} on a value of type 'dynamic' \\(the runtime has no late binder`), body);
  }
});

// ---- declarations (the second part of SF-A02-T55) ----

function codesOf(source, options = {}) {
  return compile(source, options)
    .diagnostics.filter(d => d.code.startsWith('CS'))
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
}
const withMain = declarations => `using System; using System.Collections.Generic; ${declarations} class P { static void Main() { } }`;

test('dynamic cannot be a base, an implemented interface argument or a constraint', () => {
  assert.deepEqual(codesOf(withMain('class A : dynamic { }')), ['CS1965:dynamic']);
  assert.deepEqual(codesOf(withMain('interface I<T> { } class C : I<dynamic> { }')), ['CS1966:I<dynamic>']);
  assert.deepEqual(codesOf(withMain('class D<T> where T : dynamic { }')), ['CS1967:dynamic']);
  assert.deepEqual(codesOf(withMain('class E<T> where T : List<dynamic> { }')), ['CS1968:List<dynamic>']);
  // A base class over dynamic is fine.
  assert.deepEqual(codesOf(withMain('class B : List<dynamic> { }')), []);
});

test('dynamic and object are one signature: duplicates, overrides, conversions', () => {
  assert.deepEqual(codesOf(withMain('class C { void M(dynamic x) { } void M(object x) { } }')), ['CS0111:M']);
  const overriding =
    'class A { public virtual object Get(dynamic x) { return x; } } class B : A { public override dynamic Get(object x) { return x; } }';
  assert.deepEqual(codesOf(withMain(overriding)), []);
  assert.deepEqual(codesOf(withMain('class C { public static implicit operator C(dynamic d) { return null; } }')), ['CS1964:C']);
});

test('a call that would be late bound cannot go through base or a constructor initializer', () => {
  const types = 'class A { public A(int x) { } public A(string x) { } public void One(int x) { } }';
  assert.deepEqual(codesOf(withMain(types + ' class B : A { public B(dynamic d) : base(d) { } }')), ['CS1975:base']);
  assert.deepEqual(codesOf(withMain(types + ' class B : A { public B() : base(1) { } void T(dynamic d) { base.One(d); } }')), ['CS1971:base.One(d)']);
});

test('a const of a reference type other than string can only be null (CS0134), dynamic included', () => {
  assert.deepEqual(analysed('const dynamic none = null; const dynamic one = 1; const object boxed = 2;').sort(), ['CS0134:1', 'CS0134:2']);
});

test('an expression tree may not contain a dynamic operation (CS1963); a query needs a static source (CS1979)', () => {
  const tree = body => `using System; using System.Linq.Expressions; class P { static void Main() { dynamic d = 2; ${body} } }`;
  assert.deepEqual(codesOf(tree('Expression<Func<dynamic, dynamic>> e = x => x.Foo;')), ['CS1963:x.Foo']);
  assert.deepEqual(codesOf(tree('Expression<Func<int>> e = () => d;')), ['CS1963:d']);
  assert.deepEqual(codesOf(tree('Expression<Func<dynamic, object>> e = x => x;')), []);
  assert.deepEqual(codesOf(tree('var q = from x in d select x;')), ['CS1979:d']);
});
