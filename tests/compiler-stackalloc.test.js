import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '@sharpforge/compiler';
import { linesOf } from './support/semantic-codegen.js';

// SF-A02-T66: stackalloc as a Span<T>, its shape rules and gates.

/** The C# errors of a program as `code text`, where text is the source the diagnostic covers. */
function errorsOf(source, options = {}) {
  return compile(source, options)
    .diagnostics.filter(d => d.severity === 'error' && /^CS/.test(d.code))
    .map(d => `${d.code} ${source.slice(d.start, d.start + d.length)}`);
}
const inMain = (statements, members = '') => `using System; class Program { ${members} static void Main() { ${statements} } }`;

test('SF-A02-T66 stackalloc is a Span of its element type, with and without an initializer', () => {
  const statements = `Span<int> s = stackalloc int[3]; s[0] = 1; Span<int> t = stackalloc[] { 4, 5, 6 }; Span<byte> u = stackalloc byte[2] { 7, 8 };
    ReadOnlySpan<int> r = stackalloc int[] { 9 }; int sum = 0; foreach (var x in t) sum += x; Console.WriteLine(s[0] + t.Length + u[1] + r[0] + sum);`;
  assert.deepEqual(errorsOf(inMain(statements)), []);
});

test('SF-A02-T66 spans execute on both backends after binding', () => {
  assert.deepEqual(linesOf(inMain('Span<int> s = stackalloc int[] { 1, 2, 3 }; int sum = 0; foreach (var x in s) sum += x; Console.WriteLine(sum);')), ['6']);
});

test('SF-A02-T66 shape rules: element type, size and initializer (CS0208, CS1586, CS0247, CS0847)', () => {
  assert.deepEqual(errorsOf(inMain('Span<string> e = stackalloc string[2];')), ['CS0208 string']);
  assert.deepEqual(errorsOf(inMain('Span<int> b = stackalloc int[];')), ['CS1586 []']);
  assert.deepEqual(errorsOf(inMain('Span<int> h = stackalloc int[-1];')), ['CS0247 -1']);
  assert.deepEqual(errorsOf(inMain('Span<int> a = stackalloc int[2] { 1, 2, 3 };')), ['CS0847 stackalloc int[2] { 1, 2, 3 }']);
  assert.deepEqual(errorsOf(inMain('int n = 2; Span<int> a = stackalloc int[n]; Span<int> b = stackalloc int[2] { 1, 2 }; Span<int> c = stackalloc int[0];')), []);
  assert.deepEqual(errorsOf(inMain('Span<int> i = stackalloc int["x"];')), ['CS0029 "x"']);
  assert.deepEqual(errorsOf(inMain('Span<int> d = stackalloc[] { 1, "s" };')), ['CS0826 stackalloc[] { 1, "s" }']);
});

test('SF-A02-T66 a stackalloc converts to a span of its element type only (CS8346)', () => {
  assert.deepEqual(errorsOf(inMain('Span<long> c = stackalloc int[2];')), ['CS8346 stackalloc int[2]']);
  assert.deepEqual(errorsOf(inMain('int[] f = stackalloc int[2];')), ['CS8346 stackalloc int[2]']);
  assert.deepEqual(errorsOf(inMain('object o = stackalloc int[1];')), ['CS8346 stackalloc int[1]']);
  assert.deepEqual(errorsOf(inMain('M(stackalloc int[1]); Span<int> j = true ? stackalloc int[1] : stackalloc int[2];', 'static void M(ReadOnlySpan<int> s) { }')), []);
});

test('SF-A02-T66 the pointer form needs an unsafe context (CS0214)', () => {
  assert.deepEqual(errorsOf(inMain('var g = stackalloc int[2];')), ['CS0214 stackalloc int[2]']);
  assert.ok(!errorsOf(inMain('unsafe { var g = stackalloc int[2]; }')).some(e => e.startsWith('CS0214')));
});

test('SF-A02-T66 a span of stack memory cannot leave the method (CS8352)', () => {
  assert.deepEqual(errorsOf(inMain('', 'static Span<int> R() { Span<int> s = stackalloc int[1]; return s; }')), ['CS8352 s']);
});

test('SF-A02-T66 gates: initializers need C# 7.3, a nested stackalloc needs C# 8', () => {
  const initializers = inMain('Span<int> t = stackalloc[] { 4, 5 }; Span<int> u = stackalloc int[2] { 7, 8 }; Span<int> v = stackalloc int[2];');
  const at72 = compile(initializers, { langVersion: '7.2' }).diagnostics.filter(d => d.code === 'CS8320');
  assert.deepEqual(at72.map(d => initializers.slice(d.start, d.start + d.length)), ['stackalloc', 'stackalloc']);
  const nested = inMain(
    'M(stackalloc int[1]); Span<int> j = true ? stackalloc int[1] : stackalloc int[2]; Span<int> k = (stackalloc int[1]);',
    'static void M(Span<int> s) { }',
  );
  const at73 = compile(nested, { langVersion: '7.3' }).diagnostics.filter(d => d.code === 'CS8370');
  assert.deepEqual(at73.map(d => d.start), [nested.indexOf('M(stackalloc') + 2, nested.lastIndexOf('(stackalloc int[1]);') + 1]);
  assert.match(at73[0].message, /'stackalloc in nested expressions'/);
  assert.deepEqual(compile(nested, { langVersion: '8' }).diagnostics.filter(d => d.code === 'CS8370'), []);
});
