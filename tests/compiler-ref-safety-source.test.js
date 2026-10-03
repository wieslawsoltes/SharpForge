// SF-A02-T04.6: ref safety is reported from source by the semantic analysis (flow/ref-safety.js), and every
// `ref-safety/*` differential fixture matches the diagnostics pinned from Roslyn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { RefSafety, EscapeScope, localScope } from '../packages/compiler/src/flow/ref-safety.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';
import { semanticRow } from '../packages/compiler/test/differential/tools/semantic-report.mjs';

const diagnosticsOf = source =>
  analyze([parse(new SourceText(source, 'a.cs'))])
    .diagnostics.filter(d => d.severity === 'error')
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`)
    .sort();

const inClass = body => `using System; using System.Diagnostics.CodeAnalysis;
ref struct R { public ref int P; public Span<int> F; public R(ref int p) { P = ref p; F = default; } }
struct S { public int X; [UnscopedRef] public ref int Slot() => ref X; }
static class C { ${body} static void Main() { } }`;

test('ref-safety fixtures match the pinned Roslyn errors', () => {
  const fixtures = loadFixtures().filter(fixture => fixture.feature === 'ref-safety');
  const pinned = loadPinned().results;
  assert.ok(fixtures.length >= 20, `expected the ref-safety corpus, found ${fixtures.length} fixtures`);
  const expectedCodes = new Set();
  for (const fixture of fixtures) {
    const expected = pinned.get(fixture.id);
    assert.ok(expected, `${fixture.id} is not pinned`);
    for (const row of expected.diagnostics) expectedCodes.add(row[0]);
    const row = semanticRow(fixture, expected);
    assert.equal(row.crash, undefined, `${fixture.id}: ${row.crash}`);
    assert.deepEqual(row.details, [], `${fixture.id} differs from Roslyn`);
  }
  const required = ['CS8350', 'CS8351', 'CS8352', 'CS8353', 'CS8347', 'CS8374', 'CS9075', 'CS9076', 'CS9077', 'CS9079'];
  for (const code of [...required, 'CS8156', 'CS8157', 'CS8166', 'CS8167', 'CS8168', 'CS8169', 'CS8170']) {
    assert.ok(expectedCodes.has(code), `no ref-safety fixture pins ${code}`);
  }
});

test('a stackalloc span or a local holding one cannot be returned or stored in a wider variable', () => {
  assert.deepEqual(diagnosticsOf(inClass('static Span<int> M() { Span<int> s = stackalloc int[4]; return s; }')), ['CS8352:s']);
  assert.deepEqual(diagnosticsOf(inClass('static Span<int> M() => stackalloc int[4];')), ['CS8353:stackalloc int[4]']);
  assert.deepEqual(diagnosticsOf(inClass('static void M(ref Span<int> d) { Span<int> s = stackalloc int[1]; d = s; }')), ['CS8352:s']);
  assert.deepEqual(diagnosticsOf(inClass('static Span<int> M(int[] a) { Span<int> s = a; return s; }')), []);
  assert.deepEqual(diagnosticsOf(inClass('static int M() { Span<int> s = stackalloc int[2]; s[0] = 1; return s[0] + s.Slice(1).Length; }')), []);
});

test('a call result is as narrow as its arguments and by-reference arguments must match', () => {
  assert.deepEqual(
    diagnosticsOf(inClass('static Span<int> Id(Span<int> s) => s; static Span<int> M() { Span<int> s = stackalloc int[1]; return Id(s); }')),
    ['CS8347:Id(s)', 'CS8352:s'],
  );
  assert.deepEqual(diagnosticsOf(inClass('static R M() { int v = 0; return new R(ref v); }')), ['CS8168:v', 'CS8347:new R(ref v)']);
  assert.deepEqual(
    diagnosticsOf(inClass('static void Mix(ref R a, Span<int> b) { } static void M(ref R r) { Span<int> s = stackalloc int[2]; Mix(ref r, s); }')),
    ['CS8350:Mix(ref r, s)', 'CS8352:s'],
  );
  assert.deepEqual(
    diagnosticsOf(inClass('static void Mix(ref R a, scoped Span<int> b) { } static void M(ref R r) { Span<int> s = stackalloc int[2]; Mix(ref r, s); }')),
    [],
  );
});

test('ref returns, ref assignment, scoped and UnscopedRef follow the C# 11 rules', () => {
  assert.deepEqual(diagnosticsOf(inClass('static ref int M(int p) { return ref p; }')), ['CS8166:p']);
  assert.deepEqual(diagnosticsOf(inClass('static ref int M(S s) { return ref s.X; }')), ['CS8167:s']);
  assert.deepEqual(diagnosticsOf(inClass('static ref int M() { S s = default; return ref s.X; }')), ['CS8169:s']);
  assert.deepEqual(diagnosticsOf(inClass('static ref int M(scoped ref int x) => ref x;')), ['CS9075:x']);
  assert.deepEqual(diagnosticsOf(inClass('static ref int M(scoped ref S s) => ref s.X;')), ['CS9076:s']);
  assert.deepEqual(diagnosticsOf(inClass('static ref int M(out int o) { o = 1; return ref o; }')), ['CS9075:o']);
  assert.deepEqual(diagnosticsOf(inClass('static ref int M(ref int x) => ref x;')), []);
  assert.deepEqual(diagnosticsOf(inClass('static void M(ref R r, ref int x) { r = new R(ref x); }')), ['CS8347:new R(ref x)', 'CS9077:x']);
  assert.deepEqual(diagnosticsOf(inClass('static void M(ref R r, ref int x) { r.P = ref x; }')), ['CS9079:r.P = ref x']);
  assert.deepEqual(diagnosticsOf(inClass('static void M() { int x = 0; ref int r = ref x; { int y = 1; r = ref y; } r++; }')), ['CS8374:r = ref y']);
  assert.deepEqual(diagnosticsOf(inClass('static ref int M() { S s = default; return ref s.Slot(); }')), ['CS8168:s']);
  assert.deepEqual(diagnosticsOf(inClass('static ref int M(ref S s) { return ref s.Slot(); }')), []);
  assert.deepEqual(diagnosticsOf('struct S { public int X; public ref int M() => ref X; }'), ['CS8170:X']);
});

test('safe contexts order from the calling method to nested local scopes', () => {
  const span = { isRefLikeType: true, toDisplayString: () => 'System.Span<int>' };
  const safety = new RefSafety();
  const outer = { name: 'outer', type: span, refKind: 'none' };
  const inner = { name: 'inner', type: span, refKind: 'none' };
  safety.declareLocal(outer, 0).initializeLocal(outer, null);
  safety.declareLocal(inner, 1, { scoped: true });
  assert.equal(safety.safeContext({ kind: 'Local', local: outer, type: span }), EscapeScope.CallingMethod);
  assert.equal(safety.safeContext({ kind: 'Local', local: inner, type: span }), localScope(1));
  assert.ok(EscapeScope.CallingMethod < EscapeScope.ReturnOnly && EscapeScope.ReturnOnly < EscapeScope.CurrentMethod);
  const assignment = safety.assignmentProblems({ kind: 'Local', local: outer, type: span }, { kind: 'Local', local: inner, type: span, syntax: {} });
  assert.deepEqual(
    assignment.map(found => found.code),
    ['CS8352'],
  );
  const refParameter = { name: 'x', type: {}, refKind: 'ref' };
  assert.equal(safety.parameterRefSafe(refParameter), EscapeScope.ReturnOnly);
  assert.equal(safety.parameterRefSafe({ ...refParameter, scoped: 'scoped' }), EscapeScope.CurrentMethod);
  assert.equal(safety.parameterRefSafe({ ...refParameter, refKind: 'out' }), EscapeScope.CurrentMethod);
  assert.equal(safety.parameterRefSafe({ ...refParameter, refKind: 'out', isUnscopedRef: true }), EscapeScope.ReturnOnly);
});
