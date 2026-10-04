import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';

// SF-A02-T90: closed hierarchies and closed enums (C# 15 preview). PROVISIONAL: the pinned Roslyn does not implement
// the feature, so nothing here is a Roslyn fixture. Every expectation is a rule or an example of the pinned proposal
// revisions (packages/syntax/src/preview-revisions.js): csharplang/proposals/csharp-15.0/closed-hierarchies.md and
// csharplang/proposals/closed-enums.md, commit 412dc302. Each test quotes the section it follows.

const preview = { langVersion: 'preview' };
// The string-typed pipeline adds its profile codes (SF1xxx). SF2200 is checked on its own below: the runtime has no
// class inheritance yet, so a program with a closed hierarchy is bound and checked but not executed.
const relevant = d => !/^SF1/.test(d.code) && d.code !== 'SF2200';
const found = source =>
  compile(source, preview)
    .diagnostics.filter(relevant)
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
const messages = source =>
  compile(source, preview)
    .diagnostics.filter(relevant)
    .map(d => `${d.code}:${d.message}`);
const main = 'class Program { static void Main() { } }';
const hierarchy = 'closed class C { } class D1 : C { } class D2 : C { } ';
const inProgram = (members, types = hierarchy) => `${types}class Program { ${members} static void Main() { } }`;

test('A02-T90 closed class: a switch expression over all direct descendants is exhaustive ("Exhaustiveness in switches")', () => {
  assert.deepEqual(found(inProgram('static int M(C c) { return c switch { D1 => 1, D2 => 2 }; }')), []);
  assert.deepEqual(found(inProgram('static int M(C c) { return c switch { D1 d => 1, D2 { } => 2 }; }')), []);
  // One descendant is missing: the non-exhaustiveness warning names it.
  const missing = inProgram('static int M(C c) { return c switch { D1 => 1 }; }');
  assert.deepEqual(found(missing), ['CS8509:switch']);
  assert.match(messages(missing)[0], /'D2'/);
});

test('A02-T90 closed class: the closed class after all its direct descendants cannot be reached', () => {
  // "it can be an error for the closed base class to occur as a case after all its direct descendants"
  assert.deepEqual(found(inProgram('static int M(C c) { return c switch { D1 => 1, D2 => 2, C => 3 }; }')), ['CS8510:C']);
  // Before the last descendant it is an ordinary case.
  assert.deepEqual(found(inProgram('static int M(C c) { return c switch { D1 => 1, C => 3 }; }')), []);
});

test('A02-T90 closed class: a subtype that cannot be used at the use site ("Exhaustiveness when a subtype can\'t be used")', () => {
  const types = 'closed class C { } class D1 : C { } class Container { protected class D2 : C { } } ';
  const source = inProgram('static int M(C c) { return c switch { D1 => 1 }; }', types);
  assert.deepEqual(found(source), ['CS8509:switch']);
  // "warning: switch is non-exhaustive. Pattern 'C' is not handled."
  assert.match(messages(source)[0], /'C'/);
  assert.deepEqual(found(inProgram('static int M(C c) { return c switch { D1 => 1, C => 2 }; }', types)), []);
});

test('A02-T90 closed class: no subtypes ("Exhaustiveness when no subtypes exist")', () => {
  const types = 'closed class C { } ';
  assert.deepEqual(found(inProgram('static int M1(C c) { return c switch { }; }', types)), ['CS8509:switch']);
  assert.deepEqual(found(inProgram('static int M2(C c) { return c switch { C => 1 }; }', types)), []);
});

test('A02-T90 closed class: a type parameter constrained to a closed class', () => {
  // "A type parameter constrained to a closed class is treated similarly as a closed class"
  assert.deepEqual(found(inProgram('static int M1<X>(X x) where X : C { return x switch { D1 => 1, D2 => 2 }; }')), []);
  assert.deepEqual(found(inProgram('static int M2<X>(X x) where X : C { return x switch { D1 => 1, D2 => 2, C => 3 }; }')), ['CS8510:C']);
});

test('A02-T90 closed class: generic subtypes ("Determining subtypes of a closed class")', () => {
  const types = 'closed class C<T> { } class D1<U> : C<U> { } class D2<V> : C<V[]> { } ';
  // "For C<string> there is no corresponding instantiation of D2<...>, and no case for D2<...> needs to be given"
  assert.deepEqual(found(inProgram('static int M(C<string> c) { return c switch { D1<string> => 1 }; }', types)), []);
  // C<int[]> is the base of D1<int[]> and of D2<int>.
  const both = inProgram('static int M(C<int[]> c) { return c switch { D1<int[]> => 1 }; }', types);
  assert.deepEqual(found(both), ['CS8509:switch']);
  assert.match(messages(both)[0], /'D2<int>'/);
  assert.deepEqual(found(inProgram('static int M(C<int[]> c) { return c switch { D1<int[]> => 1, D2<int> => 2 }; }', types)), []);
  // "This also applies when a generic subtype is not speakable": D2<...> may or may not apply to C<X>.
  const open = inProgram('static int M<X>(C<X> c) { return c switch { D1<X> => 1 }; }', types);
  assert.deepEqual(found(open), ['CS8509:switch']);
  assert.match(messages(open)[0], /'C<X>'/);
});

test('A02-T90 closed class: constraints of a subtype are not analysed ("Subtype constraints do not affect exhaustiveness")', () => {
  const types = 'closed class C<T> { } class D1<U1> : C<U1> { } class D2<U2> : C<U2> where U2 : struct { } ';
  assert.deepEqual(found(inProgram('static int M1<X>(C<X> c) where X : class { return c switch { D1<X> => 1 }; }', types)), ['CS8509:switch']);
  assert.deepEqual(found(inProgram('static int M2<X>(C<X> c) where X : class { return c switch { D1<X> => 1, C<X> => 2 }; }', types)), []);
});

test('A02-T90 closed class: type parameter restriction of a generic descendant', () => {
  // "all of its type parameters must be used in the base class specification"
  const types = 'closed class C<T> { } class D1<U> : C<U> { } class D2<V> : C<V[]> { } class D3<W> : C<int> { } ';
  assert.deepEqual(found(types + main), ['SF2203:D3']);
  assert.match(messages(types + main)[0], /'W'.*closed-hierarchies\.md revision 1/);
});

test('A02-T90 closed class: no conversion to an interface outside a sealed hierarchy ("Interface convertibility of closed classes")', () => {
  const types = 'interface I { } interface J { } closed class C { } sealed class D1 : C, J { } sealed class D2 : C { } ';
  assert.deepEqual(found(inProgram('static object M(C c) { return (I)c; }', types)), ['CS0030:(I)c']);
  // A subtype implements J; and a hierarchy with an unsealed subtype is not sealed.
  assert.deepEqual(found(inProgram('static object M(C c) { return (J)c; }', types)), []);
  assert.deepEqual(found(inProgram('static object M(C c) { return (I)c; }', types.replace('sealed class D2', 'class D2'))), []);
});

test('A02-T90 closed class: a valid hierarchy is bound but not executable yet (SF2200, never a miscompile)', () => {
  const source =
    'using System; closed class Shape { } sealed class Circle : Shape { public int R = 2; } sealed class Square : Shape { public int S = 3; } ' +
    'class Program { static int Area(Shape s) { return s switch { Circle c => 3 * c.R * c.R, Square q => q.S * q.S }; } ' +
    'static void Main() { Console.WriteLine(Area(new Circle())); Console.WriteLine(Area(new Square())); } }';
  const result = compile(source, preview),
    unexecutable = result.diagnostics.filter(d => d.code === 'SF2200');
  assert.deepEqual(result.diagnostics.filter(relevant).map(d => d.code), []);
  assert.equal(unexecutable.length, 1);
  assert.match(unexecutable[0].message, /class inheritance/);
  assert.equal(result.image ?? null, null);
});

const color = 'closed enum Color { Red, Green, Blue } ';
const withColor = body => `${color}class Program { static void M(Color c, int myInt) { ${body} } static void Main() { } }`;

test('A02-T90 closed enum: explicit conversions ("Enforcement")', () => {
  // The proposal's examples, in its order.
  assert.deepEqual(found(withColor('c = 0;')), []);
  assert.deepEqual(found(withColor('c = (Color)1;')), []);
  assert.deepEqual(found(withColor('c = (Color)10;')), ['SF2203:(Color)10']);
  assert.deepEqual(found(withColor('c = (Color)myInt;')), ['SF2203:(Color)myInt']);
  assert.match(messages(withColor('c = (Color)10;'))[0], /no member for the constant 10.*closed-enums\.md revision 1/);
  // Not decided by the proposal: reported as not bound, not guessed.
  assert.deepEqual(found(withColor('Color? n = (Color?)myInt;')), ['SF2202:(Color?)myInt']);
});

test('A02-T90 closed enum: operators that return the closed enum ("Enforcement")', () => {
  assert.deepEqual(found(withColor('bool b = c == Color.Blue;')), []);
  assert.deepEqual(found(withColor('c = Color.Red + 1;')), []);
  assert.deepEqual(found(withColor('c = c + 1;')), ['SF2203:c + 1']);
  assert.deepEqual(found(withColor('c = Color.Blue + 1;')), ['SF2203:Color.Blue + 1']);
  assert.deepEqual(found(withColor('c++;')), ['SF2203:c++']);
  assert.deepEqual(found(withColor('c |= Color.Green;')), ['SF2203:c |= Color.Green']);
  // An ordinary enum is unaffected.
  assert.deepEqual(found(withColor('c = c + 1; c++;').replace('closed enum', 'enum')), []);
});

test('A02-T90 closed enum: the enum type after all its members cannot be reached ("Exhaustiveness in switches")', () => {
  const body = 'int i = c switch { Color.Red => 1, Color.Green => 2, Color.Blue => 3, Color => 4 };';
  assert.deepEqual(found(withColor(body)), ['CS8510:Color']);
  assert.deepEqual(found(withColor('int i = c switch { Color.Red => 1, Color.Green => 2, Color.Blue => 3 };')), []);
});
