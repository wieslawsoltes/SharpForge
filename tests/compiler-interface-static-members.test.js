import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import { interfaceOperators, constrainedTypeParameter } from '../packages/compiler/src/overload/interface-operators.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { runFixture } from '../packages/compiler/test/differential/harness.js';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

const analysisOf = (source, options = {}) => analyze([parse(new SourceText(source, 'Program.cs'))], options);
const errorsOf = analysis => analysis.diagnostics.filter(d => d.severity === 'error').map(d => d.code);
const typeNamed = (analysis, name) => analysis.assembly.types.find(type => type.name === name);
const main = 'class Program { static void Main() { } }';

function boundNodes(analysis, kind) {
  const found = [];
  for (const body of analysis.bound.values()) walk(body, node => void (node.kind === kind && found.push(node)));
  return found;
}

const math = `
interface IAdd<T> where T : IAdd<T> {
  static abstract T operator +(T a, T b);
  static abstract T Zero { get; }
  static abstract T From(int value);
}
class Num : IAdd<Num> {
  public int V;
  public static Num operator +(Num a, Num b) { return new Num { V = a.V + b.V }; }
  public static Num Zero { get { return new Num(); } }
  public static Num From(int value) { return new Num { V = value }; }
}`;

test('SF-A02-T03.6 corpus: the most-specific-implementation and static abstract operator fixtures match Roslyn and .NET', () => {
  const pinned = loadPinned(),
    features = new Set(['interface-most-specific', 'static-abstract-operators']),
    fixtures = loadFixtures().filter(f => features.has(f.feature));
  assert.ok(fixtures.length >= 9);
  for (const fixture of fixtures) {
    const row = runFixture(fixture, pinned.results.get(fixture.id));
    assert.equal(row.passed, true, `${fixture.id}: ${JSON.stringify(row.details)}`);
  }
});

test('SF-A02-T03.6 CS8705: two interfaces implement a member and neither derives from the other', () => {
  const diamond = 'interface A { void M() { } }\ninterface B : A { void A.M() { } }\ninterface C : A { void A.M() { } }\n';
  const analysis = analysisOf(`${diamond}class D : B, C { }\n${main}`);
  assert.deepEqual(errorsOf(analysis), ['CS8705']);
  const [reported] = analysis.diagnostics.filter(d => d.code === 'CS8705');
  assert.match(reported.message, /'A\.M\(\)'.*'B\.A\.M\(\)'.*'C\.A\.M\(\)'/);
  // The class or a joining interface settles it.
  assert.deepEqual(errorsOf(analysisOf(`${diamond}class D : B, C { public void M() { } }\n${main}`)), []);
  assert.deepEqual(errorsOf(analysisOf(`${diamond}interface E : B, C { void A.M() { } }\nclass D : E { }\n${main}`)), []);
  assert.deepEqual(errorsOf(analysisOf(`${diamond}class D : B { }\n${main}`)), []);
  // A base class that implements through one interface does not settle it for a class that adds the other.
  assert.deepEqual(errorsOf(analysisOf(`${diamond}class Base : B { }\nclass D : Base, C { }\n${main}`)), ['CS8705']);
});

test('SF-A02-T03.6 the implementation map names the most specific default implementation', () => {
  const analysis = analysisOf(`interface A { void M(); int P { get; } }
interface B : A { void A.M() { } int A.P { get { return 1; } } }
interface R : B { abstract void A.M(); }
class Linear : B { }
class Again : R { }
${main}`);
  assert.deepEqual(errorsOf(analysis), ['CS0535'], 'only the re-abstracted member is missing');
  const a = typeNamed(analysis, 'A'),
    b = typeNamed(analysis, 'B'),
    map = typeNamed(analysis, 'Linear').interfaceImplementations,
    method = a.getMembers('M')[0],
    property = a.getMembers('P')[0];
  assert.equal(map.get(method).containingType, b);
  assert.equal(map.get(property).containingType, b);
  assert.equal(map.get(property.getMethod), map.get(property).getMethod);
  assert.equal(typeNamed(analysis, 'Again').interfaceImplementations.has(method), false);
});

test('SF-A02-T03.6 static abstract operators are found through the type parameter and bound as constrained members', () => {
  const analysis = analysisOf(`${math}
class Program {
  static T Sum<T>(T a, T b) where T : IAdd<T> { return T.Zero + a + b + T.From(1); }
  static void Main() { }
}`);
  assert.deepEqual(errorsOf(analysis), []);
  const binaries = boundNodes(analysis, 'Binary').filter(binary => binary.method?.containingType.name === 'IAdd'),
    [zero] = boundNodes(analysis, 'PropertyAccess'),
    [from] = boundNodes(analysis, 'Call');
  assert.equal(binaries.length, 3);
  for (const binary of binaries) {
    assert.equal(binary.method.name, 'op_Addition');
    assert.equal(binary.method.containingType.toDisplayString(), 'IAdd<T>');
    assert.equal(binary.type.name, 'T');
  }
  assert.equal(zero.constrainedTo.name, 'T');
  assert.equal(from.constrainedTo.name, 'T');
  const t = zero.constrainedTo,
    core = analysis.core;
  assert.equal(constrainedTypeParameter(binaries[0].method, [t, t], core), t);
  assert.equal(constrainedTypeParameter(binaries[0].method, [core.int], core), null);
  assert.equal(interfaceOperators(t, 'op_Addition', core)[0], binaries[0].method, 'both operands offer the same symbol');
  assert.deepEqual(interfaceOperators(t, 'op_Subtraction', core), []);
  assert.deepEqual(interfaceOperators(core.int, 'op_Addition', core), []);
});

test('SF-A02-T03.6 an interface hides the operators of its base interfaces only with an operator that applies', () => {
  const source = body => `
interface IBase<T> where T : IBase<T> { static abstract T operator +(T a, T b); static abstract T operator *(T a, long b); }
interface IDerived<T> : IBase<T> where T : IDerived<T> { static abstract T operator +(T a, int b); static abstract T operator *(T a, int b); }
class Program {
  static T Use<T>(T a) where T : IDerived<T> { ${body} }
  static void Main() { }
}`;
  const operatorOf = body => {
    const analysis = analysisOf(source(body));
    assert.deepEqual(errorsOf(analysis), [], body);
    return boundNodes(analysis, 'Binary')[0].method.toDisplayString();
  };
  assert.equal(operatorOf('return a + 1;'), 'IDerived<T>.operator +(T, int)');
  // `+ (T, int)` does not apply to (T, T): the operator of the base interface is still found.
  assert.equal(operatorOf('return a + a;'), 'IBase<T>.operator +(T, T)');
  // Both `*` apply to (T, int): the derived interface hides the base one.
  assert.equal(operatorOf('return a * 2;'), 'IDerived<T>.operator *(T, int)');
  assert.equal(operatorOf('return a * 2L;'), 'IBase<T>.operator *(T, long)');
  assert.deepEqual(errorsOf(analysisOf(source('return a / a;'))), ['CS0019']);
});

test('SF-A02-T03.6 diagnostics: CS0019 without the operator, CS8926 through the interface, CS0535 for a missing operator', () => {
  const use = (body, constraint = 'where T : IAdd<T>') =>
    errorsOf(analysisOf(`${math}\nclass Program { static void Use<T>(T a, T b) ${constraint} { ${body} } static void Main() { } }`));
  assert.deepEqual(use('var c = a - b;'), ['CS0019']);
  assert.deepEqual(use('var c = a + b;', ''), ['CS0019']);
  assert.deepEqual(use('var c = a + 1;'), ['CS0019']);
  assert.deepEqual(use('var z = IAdd<T>.Zero;'), ['CS8926']);
  assert.deepEqual(use('var z = IAdd<T>.From(1);'), ['CS8926']);
  assert.deepEqual(use('var z = T.Zero; var f = T.From(2); var s = nameof(IAdd<T>.Zero);'), []);
  assert.deepEqual(errorsOf(analysisOf(`${math}\nclass Missing : IAdd<Missing> { public static Missing Zero => null; public static Missing From(int v) => null; }\n${main}`)), [
    'CS0535',
  ]);
  // The use needs no version gate of its own: the declaration carries it.
  const old = analysisOf(`${math}\nclass Program { static T Sum<T>(T a, T b) where T : IAdd<T> { return a + b; } static void Main() { } }`, {
    langVersion: '10',
  });
  assert.ok(errorsOf(old).length > 0 && errorsOf(old).every(code => code === 'CS8703'), errorsOf(old).join(' '));
});

test('SF-A02-T03.6 execution: generic math runs where monomorphization resolves the implementing member', () => {
  const lines = linesOf(`using System;${math}
class Words : IAdd<Words> {
  public string S = "";
  public static Words operator +(Words a, Words b) { return new Words { S = a.S + b.S }; }
  public static Words Zero { get { return new Words(); } }
  public static Words From(int value) { return new Words { S = "#" + value }; }
}
class Program {
  static T Total<T>(T[] items) where T : IAdd<T> {
    T total = T.Zero;
    foreach (T item in items) total += item;
    return total + T.From(100);
  }
  static void Main() {
    Console.WriteLine(Total(new Num[] { Num.From(1), Num.From(2) }).V);
    Console.WriteLine(Total(new Words[] { Words.From(1), Words.From(2) }).S);
  }
}`);
  assert.deepEqual(lines, ['103', '#1#2#100']);
});

test('SF-A02-T03.6 unsupported: a static virtual member the type does not implement needs dispatch (SF2200)', () => {
  const reported = notExecutable(`using System;
interface INamed<T> where T : INamed<T> { static virtual string Name() { return "default"; } }
class Plain : INamed<Plain> { }
class Program {
  static string NameOf<T>() where T : INamed<T> { return T.Name(); }
  static void Main() { Console.WriteLine(NameOf<Plain>()); }
}`);
  assert.match(reported.message, /Name\(\)/);
});
