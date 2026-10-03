import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { VirtualMachine } from '@sharpforge/runtime';
import { bestCommonType, untypedInitializerProblem } from '../packages/compiler/src/binder/implicit-types.js';

// SF-A02-T52: implicitly typed locals and arrays. The Roslyn-pinned programs are the `implicit-types` fixtures of
// packages/compiler/test/differential; these tests cover the pure rules and the boundaries around them.

/** A stand-in type: `widensTo` lists the names it converts to implicitly. */
const type = (name, widensTo = []) => ({ name, widensTo, equals: other => other.name === name });
const converts = (from, to) => from.widensTo.includes(to.name);
const int = type('int', ['long', 'double', 'object']),
  long = type('long', ['double', 'object']),
  double = type('double', ['object']),
  string = type('string', ['object']),
  object = type('object');

const inMain = body => `class P { static void G() { } static void G(int x) { } static void Main() { ${body} } }`;
const reported = (body, options) => {
  const source = inMain(body);
  // Profile (SFxxxx) diagnostics next to the C# ones only say that the construct is outside the execution profile.
  return compile(source, options)
    .diagnostics.filter(d => d.code.startsWith('CS'))
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
};
const run = source => {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  return new VirtualMachine(result.image).run().output;
};

test('A02-T52 best common type: the candidate every other candidate converts to', () => {
  assert.equal(bestCommonType([int, long], converts), long);
  assert.equal(bestCommonType([long, int], converts), long);
  assert.equal(bestCommonType([int, double, long], converts), double);
  assert.equal(bestCommonType([string, object, int], converts), object);
  assert.equal(bestCommonType([int, int], converts), int);
});

test('A02-T52 best common type: none without candidates or when two candidates are unrelated', () => {
  assert.equal(bestCommonType([], converts), null);
  assert.equal(bestCommonType([int, string], converts), null);
  assert.equal(bestCommonType([string, int, long], converts), null);
  // A later common target does not rescue an earlier pair it cannot take: object is not a candidate here.
  assert.equal(bestCommonType([int, string, double], converts), null);
});

test('A02-T52 best common type: a candidate skipped by a failed comparison must still convert to the result', () => {
  // int/string has no winner, object takes both.
  assert.equal(bestCommonType([int, string, object], converts), object);
  // Two types that convert to each other have no winner either.
  const a = type('a', ['b']),
    b = type('b', ['a']);
  assert.equal(bestCommonType([a, b], converts), null);
});

test('A02-T52 an untyped var initializer names the Roslyn diagnostic and where it goes', () => {
  assert.deepEqual(untypedInitializerProblem({ literal: 'null' }), { code: 'CS0815', args: ['<null>'], at: 'declarator' });
  assert.deepEqual(untypedInitializerProblem({ kind: 'Tuple' }), { code: 'CS0815', args: ['(...)'], at: 'declarator' });
  assert.deepEqual(untypedInitializerProblem({ literal: 'default' }), { code: 'CS8716', args: [], at: 'initializer' });
  assert.deepEqual(untypedInitializerProblem({ form: 'implicitNew' }), { code: 'CS8754', args: ['new()'], at: 'initializer' });
  assert.deepEqual(untypedInitializerProblem({ form: 'collection' }), { code: 'CS9176', args: [], at: 'initializer' });
});

test('A02-T52 var initializers without a type are reported where Roslyn reports them', () => {
  assert.deepEqual(reported('var b = null;'), ['CS0815:b = null']);
  assert.deepEqual(reported('var d = default;'), ['CS8716:default']);
  assert.deepEqual(reported('var e = { 1, 2 };'), ['CS0820:e = { 1, 2 }']);
  assert.deepEqual(reported('const var c = 1; System.Console.WriteLine(c);'), ['CS0822:var c = 1']);
  assert.deepEqual(reported('var[] q = new int[1];'), ['CS0825:var']);
});

test('A02-T52 lambda and method group initializers: natural type from C# 10, gated below', () => {
  assert.deepEqual(reported('var b = x => x;'), ['CS8917:x => x']);
  assert.deepEqual(reported('var d = G;'), ['CS8917:G']);
  assert.deepEqual(reported('object o = x => x;'), ['CS8917:=>']);
  const below = compile(inMain('var a = () => 1;'), { langVersion: '9' }).diagnostics.filter(d => d.code.startsWith('CS'));
  assert.deepEqual(
    below.map(d => [d.code, d.message]),
    [['CS8773', "Feature 'inferred delegate type' is not available in C# 9.0. Please use language version 10.0 or greater."]],
  );
});

test('A02-T52 implicitly typed arrays: no best type, and the element that does not convert', () => {
  assert.deepEqual(reported('var a = new[] { 1, "a" };'), ['CS0826:new[] { 1, "a" }']);
  assert.deepEqual(reported('var a = new[] { };'), ['CS0826:new[] { }']);
  assert.deepEqual(reported('var a = new[] { 1, null };'), ['CS0037:null']);
});

test('A02-T52 implicitly typed locals and arrays run on the bytecode VM', () => {
  const source =
    'using System; class P { static int Twice(int x) { return x * 2; } static void Main() { ' +
    'var a = new[] { 1, 2.5 }; var s = new[] { "x", null }; var t = true ? 1 : 2.5; ' +
    'var f = (int x) => x + 1; var g = Twice; ' +
    'Console.WriteLine(a[1] + " " + s.Length + " " + t + " " + f(1) + " " + g(4)); } }';
  assert.equal(run(source), '2.5 2 1 2 8\n');
});
