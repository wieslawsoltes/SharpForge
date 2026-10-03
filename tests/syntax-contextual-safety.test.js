import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntaxTree, parse, lex } from '@sharpforge/syntax';
import { SourceText } from '@sharpforge/text';
import { shapeOf } from './support/syntax-reference.js';

// SF-A01-T10.2: the contextual-identifier corpus for the preview safety keywords (and the other preview words): fields,
// locals, parameters, types and methods named `safe`, `union` and `closed` parse exactly as before at every LangVersion.
const corpus = word => [
  `class C { int ${word}; static ${word} shared; ${word} typed = null; const int ${word}2 = 1; }`,
  `class C { ${word} M(${word} p, int ${word}) { ${word} local = p; var copy = ${word}; ${word} = copy + 1; return local; } }`,
  `class C { void M() { int ${word} = 1; ${word}++; ${word} += 2; M(${word}); var x = ${word} * 2 + ${word}.GetHashCode(); if (${word} > 0) return; } }`,
  `class C { void ${word}() { ${word}(); this.${word}(); } int ${word}2 => 0; void N() { ${word}(); } }`,
  `class C { ${word} P { get; set; } ${word}[] Array; System.Collections.Generic.List<${word}> List; ${word}? Nullable; ${word}.Inner Qualified; }`,
  `class ${word} { ${word}() { } ~${word}() { } public static ${word} operator +(${word} a, ${word} b) => a; }`,
  `struct ${word} { public int Value; }\ninterface I${word} { ${word} Get(); }\nenum E { ${word}, Other }\ndelegate ${word} D(${word} ${word});`,
  `namespace ${word} { class T { } }\nnamespace N { using ${word}; class U : ${word}.T { } }`,
  `class C { void M(object o) { if (o is ${word} s) { } var t = typeof(${word}); var d = default(${word}); var c = (${word})o; var n = new ${word}(); var a = o as ${word}; } }`,
  `class C { void M() { ${word}: for (;;) { goto ${word}; } } event System.Action ${word}; [${word}] int attributed; }`,
  `class C { void M() { System.Func<int, int> f = ${word} => ${word} + 1; var q = from ${word} in items select ${word}; foreach (var ${word} in items) { } } }`,
  `class C<${word}> where ${word} : class { ${word} Value; ${word} M<${word}2>(${word}2 x) => default; }`
];
const neutral = 'zzzz';
test('contextual: fields, locals, types and methods named safe, union or closed parse like any other identifier', () => {
  for (const word of ['safe', 'union', 'closed']) for (const [index, text] of corpus(word).entries()) {
    const reference = shapeOf(SyntaxTree.parseText(corpus(neutral)[index]).root).replaceAll(neutral, word), errors = SyntaxTree.parseText(corpus(neutral)[index]).getDiagnostics().map(d => d.code);
    for (const version of ['1', '2', '5', '7.3', '9', '12', '14', 'preview', undefined]) {
      const tree = SyntaxTree.parseText(text, { languageVersion: version }), label = `${word} #${index} at ${version}`;
      assert.equal(tree.toFullString(), text); assert.equal(shapeOf(tree.root), reference, label + ': same tree as a neutral identifier');
      assert.deepEqual(tree.getDiagnostics().filter(d => !/not available in C#/.test(d.message)).map(d => d.code), errors, label);
      for (const token of tree.root.descendantTokens()) if (token.text === word) assert.equal(token.kind, 'IdentifierToken', label);
    }
  }
});
test('contextual: zero behaviour change for LangVersion 14 and lower', () => {
  // Every corpus source produces the same tokens, legacy AST and diagnostics with and without a language version up to 14.
  for (const word of ['safe', 'union', 'closed']) for (const text of corpus(word)) {
    const tokens = lex(new SourceText(text)).tokens.map(t => t.kind + ':' + t.text).join(' '); assert(!tokens.includes('Keyword:' + word));
    const baseline = parse(text, undefined, { languageVersion: '14' }), keys = d => d.map(x => `${x.code}@${x.start}`).sort();
    for (const version of ['8', '11', '13']) { const result = parse(text, undefined, { languageVersion: version }); assert.deepEqual(JSON.stringify(result.root), JSON.stringify(baseline.root), `${word} at ${version}`); assert.deepEqual(keys(result.diagnostics.filter(d => !/not available in C#/.test(d.message))), keys(baseline.diagnostics.filter(d => !/not available in C#/.test(d.message)))); }
    assert.deepEqual(JSON.stringify(parse(text).root), JSON.stringify(baseline.root), 'preview parsing gives the same legacy AST for identifier uses');
  }
});
test('contextual: the words become keywords only in the new declaration positions', () => {
  const kinds = (text, word) => [...SyntaxTree.parseText(text, { languageVersion: 'preview' }).root.descendantTokens()].filter(t => t.text === word).map(t => t.kind);
  assert.deepEqual(kinds('class safe { safe extern static safe M(safe safe); safe safe2; safe safe { get; } }', 'safe'), ['IdentifierToken', 'SafeKeyword', 'IdentifierToken', 'IdentifierToken', 'IdentifierToken', 'IdentifierToken', 'IdentifierToken', 'IdentifierToken']);
  assert.deepEqual(kinds('class C { safe safe field; safe void M() { int safe = 0; safe++; } }', 'safe'), ['SafeKeyword', 'IdentifierToken', 'SafeKeyword', 'IdentifierToken', 'IdentifierToken']);
  assert.deepEqual(kinds('union union(union, int); class C { union f; }', 'union'), ['UnionKeyword', 'IdentifierToken', 'IdentifierToken', 'IdentifierToken']);
  assert.deepEqual(kinds('closed class closed { closed f; } closed enum E { closed }', 'closed'), ['ClosedKeyword', 'IdentifierToken', 'IdentifierToken', 'ClosedKeyword', 'IdentifierToken']);
  assert.deepEqual(kinds('class C { @safe void M() { } @closed class N { } }', 'safe'), [], 'escaped identifiers are never keywords');
  const escaped = SyntaxTree.parseText('@union Pet(Cat, Dog);', { languageVersion: 'preview' }); assert(escaped.root.members[0].kind !== 'UnionDeclaration');
});
