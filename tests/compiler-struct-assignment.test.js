// SF-A02-T34: definite assignment of struct fields. Before C# 11 a struct constructor must assign every field
// (CS0171 / CS0843) and may not read them or use `this` earlier (CS9015 / CS9014 / CS0188); from C# 11 they are
// auto-defaulted. The `struct-assignment/*` differential fixtures are pinned with Roslyn at LangVersion 10 and latest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { analyze } from '../packages/compiler/src/semantic-analysis.js';
import { loadFixtures, loadPinned } from '../packages/compiler/test/differential/corpus.js';

const errorsOf = (source, langVersion) => {
  const file = parse(new SourceText(source, 'a.cs'), undefined, langVersion ? { languageVersion: langVersion } : {});
  return analyze([file], langVersion ? { langVersion } : {})
    .diagnostics.filter(d => d.severity === 'error')
    .sort((a, b) => a.start - b.start)
    .map(d => `${d.code}:${source.slice(d.start, d.start + d.length)}`);
};

test('struct-assignment fixtures match the pinned Roslyn diagnostics at their language version', () => {
  const fixtures = loadFixtures().filter(fixture => fixture.feature === 'struct-assignment');
  const pinned = loadPinned().results;
  assert.ok(fixtures.length >= 8, `expected the struct-assignment corpus, found ${fixtures.length} fixtures`);
  const codes = new Set();
  for (const fixture of fixtures) {
    const expected = pinned.get(fixture.id);
    assert.ok(expected, `${fixture.id} is not pinned`);
    assert.equal(expected.langVersion, fixture.langVersion ? '10.0' : expected.langVersion, `${fixture.id} language version`);
    const options = fixture.langVersion ? { languageVersion: fixture.langVersion } : {};
    const file = parse(new SourceText(fixture.source, 'Program.cs'), undefined, options);
    const result = analyze([file], fixture.langVersion ? { langVersion: fixture.langVersion } : {});
    const got = [...new Set(result.diagnostics.map(d => `${d.code}@${d.start}+${d.length}`))].sort();
    const want = [...new Set(expected.diagnostics.map(row => `${row[0]}@${row[1]}+${row[2]}`))].sort();
    assert.deepEqual(got, want, `${fixture.id} differs from Roslyn`);
    for (const row of expected.diagnostics) codes.add(row[0]);
  }
  for (const code of ['CS0171', 'CS0843', 'CS0188', 'CS9014', 'CS9015', 'CS0170']) {
    assert.ok(codes.has(code), `no struct-assignment fixture pins ${code}`);
  }
});

test('before C# 11 every field and auto-property must be assigned when the constructor returns', () => {
  assert.deepEqual(errorsOf('struct P { public int X, Y; public P(int x) { X = x; } }', '10'), ['CS0171:P']);
  assert.deepEqual(errorsOf('struct P { public int X { get; } public int Y { get; set; } public P(int x) { X = x; } }', '10'), ['CS0843:P']);
  assert.deepEqual(errorsOf('struct P { public int X; public P(bool b) { if (b) return; X = 1; } }', '10'), ['CS0171:return;']);
  assert.deepEqual(errorsOf('struct P { public int X, Y; public P(int x) : this() { X = x; } }', '10'), []);
  assert.deepEqual(errorsOf('struct P { public int X, Y; public P(int x) { this = default; } }', '10'), []);
  assert.deepEqual(errorsOf('struct P { public int X; public int Y = 2; public P(int x) { X = x; } }', '10'), []);
});

test('before C# 11 a field, an auto-property or this cannot be used before it is assigned', () => {
  assert.deepEqual(errorsOf('struct P { public int X, Y; public P(int x) { Y = X; X = x; } }', '10'), ['CS9015:X']);
  assert.deepEqual(errorsOf('struct P { public int X { get; set; } public int Y; public P(int x) { Y = X; X = x; } }', '10'), ['CS9014:X']);
  assert.deepEqual(errorsOf('struct P { public int X; public P(int x) { Show(); X = x; } void Show() { } }', '10'), ['CS0188:Show']);
  assert.deepEqual(errorsOf('struct P { public int X; public P(int x) { Use(this); X = x; } static void Use(P p) { } }', '10'), ['CS0188:this']);
  // A field read before assignment is reported once and still counts as unassigned at the end.
  assert.deepEqual(errorsOf('struct P { public int X, Y; public P(int x) { Y = X + X; } }', '10'), ['CS0171:P', 'CS9015:X']);
});

test('from C# 11 struct constructors auto-default what they leave unassigned', () => {
  const sources = [
    'struct P { public int X, Y; public P(int x) { X = x; } }',
    'struct P { public int X { get; } public int Y { get; set; } public P(int x) { X = x; } }',
    'struct P { public int X, Y; public P(int x) { Y = X; X = x; } }',
    'struct P { public int X; public P(int x) { Show(); X = x; } void Show() { } }',
    'struct P { public int X; public P(int x) { Use(this); X = x; } static void Use(P p) { } }',
  ];
  for (const source of sources) {
    assert.deepEqual(errorsOf(source, '11'), [], source);
    assert.deepEqual(errorsOf(source), [], source);
  }
});

test('struct fields are tracked at every nesting depth', () => {
  const types = 'struct I { public int X, Y; } struct O { public I Inner; public int Z; } ';
  const inMain = body => `${types}static class C { static void Use(O o) { } static void Main() { ${body} } }`;
  assert.deepEqual(errorsOf(inMain('O o; o.Inner.X = 1; o.Inner.Y = 2; o.Z = 3; Use(o);')), []);
  assert.deepEqual(errorsOf(inMain('O o; o.Inner.X = 1; o.Z = 3; Use(o);')), ['CS0165:o']);
  assert.deepEqual(errorsOf(inMain('O o; o.Inner.X = 1; int y = o.Inner.Y; y++;')), ['CS0170:o.Inner.Y']);
  assert.deepEqual(errorsOf(`${types}struct W { public I Inner; public W(int z) { Inner.X = z; } }`, '10'), ['CS0171:W']);
  assert.deepEqual(errorsOf(`${types}struct W { public I Inner; public W(int z) { Inner.X = z; Inner.Y = z; } }`, '10'), []);
});
