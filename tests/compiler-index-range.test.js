import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { walk } from '../packages/compiler/src/bound/semantic-walker.js';
import { linesOf, notExecutable } from './support/semantic-codegen.js';

// SF-A02-T67: indices and ranges.

/** The C# errors of a program as `code text`, where text is the source the diagnostic covers. */
function errorsOf(source, options = {}) {
  return compile(source, options)
    .diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code))
    .map(d => `${d.code} ${source.slice(d.start, d.start + d.length)}`);
}
const types = `
  class Counted {
    int[] d = { 1, 2, 3, 4 };
    public int Length { get { Console.Write("[Length]"); return d.Length; } }
    public int this[int i] { get { return d[i]; } set { d[i] = value; } }
    public string Slice(int start, int length) { return start + ":" + length; }
  }
  class ByCount { public int Count { get { return 3; } } public int this[int i] { get { return i * 10; } } }
  class Plain { public int this[int i] { get { return i; } } }`;
const inMain = statements => `using System;${types}
  class Program { static void Main() { int[] a = { 1, 2, 3, 4, 5 }; string s = "hello"; ${statements} } }`;
/** The bound nodes of every body of a program, by kind. */
function boundKinds(source) {
  const result = analyze([parse(new SourceText(source, 'Program.cs'))], {}),
    kinds = [];
  for (const body of result.bound.values())
    walk(body, node => {
      kinds.push(node.kind);
      return true;
    });
  return kinds;
}

test('SF-A02-T67 ^n and a..b have the types System.Index and System.Range', () => {
  assert.deepEqual(errorsOf(inMain('Index i = ^1; Range r = 1..^1; Range all = ..; Index j = 2; var v = ^2; var w = ..3; Index k = v; Range q = w;')), []);
  assert.deepEqual(errorsOf(inMain('int x = ^1;')), ['CS0029 ^1']);
  assert.deepEqual(errorsOf(inMain('Index i = ^1L;')), ['CS0029 ^1L']);
  assert.deepEqual(errorsOf(inMain('Range r = "x"..;')), ['CS0029 "x"']);
  assert.deepEqual(errorsOf(inMain('var z = ^^1;')), ['CS0029 ^^1']);
});

test('SF-A02-T67 an element from the end of an array is read and written in place', () => {
  const lines = linesOf(inMain(`
    Console.WriteLine(a[^1] + " " + a[^5]);
    a[^1] = 50; a[^2] += 5; a[^3]++;
    Console.WriteLine(a[4] + " " + a[3] + " " + a[2]);
    int n = 2; Console.WriteLine(a[^n]);`));
  assert.deepEqual(lines, ['5 1', '50 9 4', '9']);
});

test('SF-A02-T67 a range of an array is a new array', () => {
  const lines = linesOf(inMain(`
    int[] b = a[1..3], c = a[..2], d = a[3..], e = a[..], f = a[1..^1], g = a[^2..];
    Console.WriteLine(b.Length + " " + b[0] + b[1] + " " + c[1] + " " + d[0] + " " + e.Length + " " + f[2] + " " + g[0] + " " + a[0..0].Length);
    e[0] = 99; Console.WriteLine(a[0]);
    string[] words = { "x", "y", "z" }; Program[] objects = { new Program(), null }; double[] reals = { 1.5, 2.5 };
    Console.WriteLine(words[1..][0] + objects[..1].Length + reals[1..][0]);`));
  assert.deepEqual(lines, ['2 23 2 4 5 4 4 0', '1', 'y12.5']);
});

test('SF-A02-T67 a range of a string is a substring', () => {
  const lines = linesOf(inMain('int n = 1; Console.WriteLine(s[1..3] + " " + s[..^2] + " " + s[2..] + " " + s[..] + " " + s[n..^n] + "|" + s[2..2] + "|");'));
  assert.deepEqual(lines, ['el hel llo hello ell||']);
});

test('SF-A02-T67 a countable type with an int indexer or Slice supports Index and Range implicitly', () => {
  const lines = linesOf(inMain(`
    var l = new Counted();
    Console.WriteLine(l[^1] + " " + l[1..3] + " " + l[..^1] + " " + l[2..]);
    l[^2] = 9; l[^2] += 1; l[^2]++; Console.WriteLine(l[2]);
    var c = new ByCount(); Console.WriteLine(c[^1]);`));
  // The length is read once per access, and only when an operand counts from the end or the range is open.
  assert.deepEqual(lines, ['[Length][Length][Length]4 1:2 0:3 2:2', '[Length][Length][Length]11', '20']);
});

test('SF-A02-T67 the receiver is evaluated once, then the operands, then the length', () => {
  const lines = linesOf(`using System;${types}
    class Program {
      static Counted Get(Counted c) { Console.Write("[receiver]"); return c; }
      static int One() { Console.Write("[one]"); return 1; }
      static void Main() {
        var l = new Counted();
        Get(l)[^One()] += 5; Console.WriteLine();
        Get(l)[^One()] = One(); Console.WriteLine();
        Console.WriteLine(Get(l)[One()..^One()]);
      }
    }`);
  assert.deepEqual(lines, ['[receiver][one][Length]', '[receiver][one][Length][one]', '[receiver][one][one][Length]1:2']);
});

test('SF-A02-T67 a type that is not countable, indexable or sliceable reports the ordinary argument error', () => {
  assert.deepEqual(errorsOf(inMain('var p = new Plain(); Console.WriteLine(p[^1]);')), ['CS1503 ^1']);
  assert.deepEqual(errorsOf(inMain('var p = new Plain(); Console.WriteLine(p[1..]);')), ['CS1503 1..']);
  assert.deepEqual(errorsOf(inMain('var c = new ByCount(); Console.WriteLine(c[1..]);')), ['CS1503 1..']);
  assert.deepEqual(errorsOf(inMain('int[,] m = new int[2, 2]; Console.WriteLine(m[^1, 0]);')), ['CS0029 ^1']);
});

test('SF-A02-T67 an indexed element is assignable, a slice is not', () => {
  assert.deepEqual(errorsOf(inMain('a[1..2] = null;')), ['CS0131 a[1..2]']);
  assert.deepEqual(errorsOf(inMain("s[^1] = 'x';")), ['CS0200 s[^1]']);
  assert.deepEqual(errorsOf(inMain('var c = new ByCount(); c[^1] = 2;')), ['CS0200 c[^1]']);
});

test('SF-A02-T67 an indexer that takes an Index or a Range is used as declared', () => {
  const source = `using System;
    class Both { public int Length { get { return 4; } } public string this[Index i] { get { return "index"; } } public int this[int i] { get { return i; } } }
    class Program { static void Main() { var b = new Both(); string viaIndex = b[^1]; int viaInt = b[1]; Console.WriteLine(viaIndex + viaInt); } }`;
  assert.deepEqual(errorsOf(source), []);
  assert.ok(!boundKinds(source).includes('ImplicitIndexerAccess'));
  assert.ok(boundKinds(inMain('Console.WriteLine(a[^1]);')).includes('ImplicitIndexerAccess'));
});

test('SF-A02-T67 Index and Range values need runtime types and are reported as not executable', () => {
  assert.match(notExecutable(inMain('Index i = ^2; Console.WriteLine(a[i]);')).message, /Index/);
  assert.match(notExecutable(inMain('Range r = 1..3; Console.WriteLine(a[r].Length);')).message, /Range/);
});

test('SF-A02-T67 the index and range operators need C# 8', () => {
  const source = inMain('Console.WriteLine(a[^1]); Console.WriteLine(a[1..].Length);');
  const gates = compile(source, { langVersion: '7.3' }).diagnostics.filter(d => d.code === 'CS8370');
  assert.deepEqual(gates.map(d => source.slice(d.start, d.start + d.length)), ['^1', '1..']);
  assert.deepEqual(compile(source, { langVersion: '8' }).diagnostics.filter(d => d.code === 'CS8370'), []);
});
