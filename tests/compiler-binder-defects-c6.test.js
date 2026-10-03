import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';

// Three binder defects reported against the C# 1-6 rules; the Roslyn-pinned programs are the
// `null-conditional-element`, `nullable-coalesce` and `goto-reachability` fixtures of packages/compiler/test/differential.

function analysed(source) {
  const result = analyze([parse(new SourceText(source, 'Program.cs'))], {});
  assert.equal(result.incomplete, false, 'the analysis is complete');
  return result.diagnostics.map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
}
const inClass = members => `using System; class P { ${members} static void Main() { } }`;

test('null-conditional element access is bound: a?[i], and indexing a type without an indexer is CS0021', () => {
  assert.deepEqual(analysed(inClass('static int F(int[] a) { return a?[0] ?? -1; }')), []);
  assert.deepEqual(analysed(inClass('static string F(string[] a) { return a?[0]; }')), []);
  assert.deepEqual(analysed(inClass('static void F(object o) { var x = o?[0]; }')), ['CS0021:[0]']);
});

test('?? over T? of a struct-constrained type parameter has no false CS0019', () => {
  assert.deepEqual(analysed(inClass('static T? F<T>(T? a, T? b) where T : struct { return a ?? b; }')), []);
  assert.deepEqual(analysed(inClass('static T F<T>(T? a, T b) where T : struct { return a ?? b; }')), []);
  assert.deepEqual(analysed(inClass('static T? F<T>(T? a, T? b, T? c) where T : struct { return a ?? b ?? c; }')), []);
  // Unrelated operands are still an error.
  assert.deepEqual(analysed(inClass('static int F(int? a) { return a ?? "s"; }')).map(d => d.slice(0, 6)), ['CS0019']);
});

test('CS0162 is reported in methods that use goto, once per unreachable run', () => {
  const body = 'static int A() { goto end; Console.WriteLine("dead"); end: return 1; Console.WriteLine("dead2"); }';
  assert.deepEqual(analysed(inClass(body)), ['CS0162:Console', 'CS0162:Console']);
});

test('code after a label is reachable; a label inside a lambda does not count', () => {
  assert.deepEqual(analysed(inClass('static void B(int n) { top: if (n > 0) { n--; goto top; } }')), []);
  // A label inside a lambda is not a target for the enclosing method.
  const lambda = 'static void D() { return; Action a = () => { goto l; l: ; }; }';
  assert.deepEqual(analysed(inClass(lambda)), ['CS0162:Action']);
});
