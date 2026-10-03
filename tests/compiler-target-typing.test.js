/**
 * SF-A02-T71: target-typed `new()`, conditional and switch expressions. The Roslyn-pinned cases are in
 * packages/compiler/test/differential/fixtures/target-typing.js; these tests cover the lowering of a choice between
 * a primitive and a reference on both back ends, the language-version boundary and the stated limits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

const codes = (source, options) =>
  compile(source, options)
    .diagnostics.filter(d => d.severity === 'error')
    .map(d => d.code);

test('SF-A02-T71 a primitive and a reference branch meet in an object on both back ends', () => {
  const source = `using System;
class Program {
  static object Pick(int k) => k switch { 0 => 1, 1 => 2.5, 2 => true, _ => "text" };
  static void Main(string[] args) {
    bool empty = args.Length == 0;
    for (int k = 0; k < 4; k++) Console.WriteLine(Pick(k));
    object o = empty ? 7 : "seven";
    Console.WriteLine("value " + o);
    object same = empty ? 1 : 2;
    Console.WriteLine(same);
  }
}
`;
  assert.deepEqual(linesOf(source), ['1', '2.5', 'True', 'text', 'value 7', '1']);
});

test('SF-A02-T71 a target-typed choice inside an iterator keeps its temporary across yields', () => {
  const source = `using System;
using System.Collections.Generic;
class Program {
  static IEnumerable<object> Items(bool flag) {
    yield return flag ? 1 : "one";
    yield return !flag ? 2 : "two";
  }
  static void Main() { foreach (object item in Items(true)) Console.WriteLine(item); }
}
`;
  assert.deepEqual(linesOf(source), ['1', 'two']);
});

test('SF-A02-T71 the conditional conversion is a C# 9 feature; a natural type never needs it', () => {
  const targetTyped = 'class Program { static void Main(string[] a) { object o = a.Length == 0 ? 1 : "s"; } }';
  assert.deepEqual(codes(targetTyped, { langVersion: '8' }), ['CS8957']);
  assert.deepEqual(codes(targetTyped, { langVersion: '9' }), []);
  const natural = 'class Program { static void Main(string[] a) { object o = a.Length == 0 ? 1 : 2; } }';
  assert.deepEqual(codes(natural, { langVersion: '8' }), []);
});

test('SF-A02-T71 new() creates the target type or reports why it cannot', () => {
  const program = body => `class Box { public int V; public Box(int v) { V = v; } }\nclass Program { static void Main() { ${body} } }`;
  assert.deepEqual(codes(program('Box b = new(1);')), []);
  assert.deepEqual(codes(program('Box b = new();')), ['CS7036']);
  assert.deepEqual(codes(program('int[] a = new();')), ['CS8752']);
  assert.deepEqual(codes(program('var v = new(1);')), ['CS8754']);
  assert.deepEqual(codes(program('Box b = new(1);'), { langVersion: '8' }), ['CS8400']);
});

test('SF-A02-T71 limit: a choice between two classes needs a class hierarchy the runtime cannot execute', () => {
  const source = `class A { } class B : A { } class C : A { }
class Program { static void Main(string[] args) { A a = args.Length == 0 ? new B() : new C(); } }
`;
  assert.match(notExecutable(source).message, /class inheritance/);
});
