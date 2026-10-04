import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { parse, parseExpression, toLegacyTree, SyntaxTree, lex } from '@sharpforge/syntax';
import { compile } from '@sharpforge/compiler';
import { SourceText } from '@sharpforge/text';
import { parse as legacyParse, parseExpression as legacyParseExpression } from './support/legacy-syntax/parser.js';
import { repoRoot, repositorySources } from './support/syntax-reference.js';

// SF-A01-T02.8: parse() now runs the lossless parser and converts the red tree with the legacy adapter. The pre-refactor
// parser is kept under tests/support/legacy-syntax as the oracle: for every source the test suite parsed before the
// refactor (recorded corpus) and every C# file in the repository, the adapter output must be deep-equal.
const corpus = JSON.parse(gunzipSync(readFileSync(join(repoRoot, 'tests/fixtures/syntax-legacy-corpus.json.gz'))).toString('utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
function compare(sources) {
  let equal = 0, skipped = 0;
  for (const text of sources) {
    let before; try { before = legacyParse(text); } catch { skipped++; continue; }
    const after = parse(text);
    assert.equal(after.green.fullText, text, 'lossless tree round-trips');
    if (before.diagnostics.length) { skipped++; continue; }
    assert.deepEqual(after.diagnostics.map(d => d.code + ' ' + d.message), [], JSON.stringify(text.slice(0, 200)));
    assert.deepStrictEqual(plain(after.root), plain(before.root), JSON.stringify(text.slice(0, 200)));
    equal++;
  }
  return { equal, skipped };
}
test('legacy adapter: output is deep-equal to the pre-refactor parser for every recorded test source', () => {
  assert(corpus.length > 900, String(corpus.length));
  const { equal, skipped } = compare(corpus);
  assert(equal > 850, `only ${equal} sources compared`); assert(skipped < 40, `${skipped} sources skipped`);
});
test('legacy adapter: output is deep-equal for the repository examples and templates', () => {
  const sources = repositorySources().filter(s => !s.name.startsWith('packages/syntax/test')).map(s => s.text);
  assert(sources.length > 100); assert(compare(sources).equal > 100);
});
test('legacy adapter: result keeps the consumer-facing shape', () => {
  const result = parse('namespace A.B { class C { int f; } } Console.WriteLine(1);');
  assert.deepEqual(Object.keys(result).slice(0, 6), ['source', 'tokens', 'root', 'diagnostics', 'internedTokenHits', 'nodeCount']);
  assert.equal(result.root.kind, 'CompilationUnit'); assert.equal(result.root.members[0].namespace, 'A.B'); assert.equal(result.root.statements.length, 1);
  assert.equal(result.syntax.kind, 'CompilationUnit'); assert.equal(result.syntax.members[0].kind, 'NamespaceDeclaration', 'the lossless tree keeps the namespace node');
  assert.deepEqual(plain(toLegacyTree(SyntaxTree.parseText(result.source).root, result.source, lex(result.source).tokens, () => {})), plain(result.root));
});
test('legacy adapter: expressions match the pre-refactor parseExpression', () => {
  for (const text of ['a = b = 1 + 2 * 3', 'x?.y[0].z(1, 2)', 'a ? b : c ?? d', '(a + b) * (c - d)', 'new List<int> { 1, 2 }', 'f(x)[1]++ + --y', '$"a{b,3:N2}c{{d}}"', 'x switch { 1 => 2, _ => 3 }', 'checked(a + (int)b)', 'new int[3]', 'new[] { 1, 2 }', '[1, ..xs]', 'await f(x)', 'default(int)', 'a.b.c = d']) {
    const before = legacyParseExpression(text), after = parseExpression(text);
    assert.deepEqual(after.diagnostics, [], text); assert.deepStrictEqual(plain(after.expression), plain(before.expression), text);
  }
});
test('legacy adapter: syntax the back end cannot bind keeps a not-supported diagnostic and never crashes the compiler', () => {
  const cases = [
    ['struct S { int a; }', 'SF1010'], ['interface I { void M(); }', 'SF1010'], ['enum E { A }', 'SF1010'], ['delegate void D();', 'SF1010'], ['namespace N { struct S { } }', 'SF1010'],
    ['class A { class B { } }', 'SF1015'], ['class A { struct B { } }', 'SF1015'], ['class A { public virtual void M() { } }', 'SF1011'], ['class A { void M(ref int x) { } }', 'SF1017'],
    ['class A { int? x; }', 'SF1013'], ['class A : Base { }', 'SF1014'], ['class A<T> { }', 'SF1012'], ['class A { Foo<int> x; }', 'SF1012'], ['class A { event System.Action E; }', 'SF1018'],
    ['class A { int this[int i] { get { return 0; } } }', 'SF1018'], ['class A { public static A operator +(A x, A y) { return x; } }', 'SF1018'], ['class A { int* p; }', 'SF1019'], ['class A { (int, int) t; }', 'SF1019'],
    ['[System.Obsolete] class A { }', 'SF1018'], ['class C{public int X{get;init;}}', 'CS1014'], ['var f = x => x;', 'SF2098'], ['var f = delegate { };', 'SF2098'], ['var q = from x in xs select x;', 'SF2098'],
    ['object o = 1; var b = o is int;', 'SF2098'], ['object o = 1; var s = o as string;', 'SF2098'], ['var t = (1, 2);', 'SF2098'], ['int i = 0; L: i++; goto L;', 'SF2099'], ['void F() { int G() { return 1; } }', 'SF2099'],
    ['var x = 1.2f;', 'SF1005'], ['var x = 1L;', 'SF1003'], ['var x = 5000000000;', 'SF1004'], ['var s = "x"u8;', 'SF2098'], ['int x = 1; var y = x switch { > 0 => 1, _ => 0 };', 'CS0150']
  ];
  for (const [source, code] of cases) {
    // The statement comes first: a top-level statement after a type declaration is an error of its own (CS8803).
    const result = compile('Console.WriteLine(1); ' + source);
    assert.equal(result.success, false, source); assert(result.diagnostics.some(d => d.code === code), `${source}: expected ${code}, got ${result.diagnostics.map(d => d.code).join(' ')}`);
    assert(!result.diagnostics.some(d => d.code === 'CS0246' && /'(?:goto|is|as|int|string)'/.test(d.message)), source);
  }
});
test('legacy adapter: newly accepted syntax that maps onto existing nodes compiles', () => {
  for (const source of ['var c = new C(); Console.WriteLine(c.a + c.b); class C { public int a = 1, b = 2; }', '#if DEBUG\nint x = bad;\n#else\nint x = 2;\n#endif\n#region r\nConsole.WriteLine(x);\n#endregion', 'Console.WriteLine("""raw "quoted" text""");', 'int x = 1; x <<= 2; x >>= 1; Console.WriteLine(x);', '#nullable enable\n#pragma warning disable CS0168\nConsole.WriteLine(1);']) {
    const result = compile(source); assert.equal(result.success, true, source + ' ' + JSON.stringify(result.diagnostics.map(d => d.code + ' ' + d.message)));
  }
  assert(new SourceText('x') instanceof SourceText);
});
