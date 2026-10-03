import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SyntaxTree, languageFeature } from '@sharpforge/syntax';
import { diagnosticsOf, fixtureRoot } from './support/syntax-reference.js';

// Defects reported by the compiler workstream: #pragma diagnostics and their spans, the span of CS1529, and the
// feature recorded for `await using`. Expectations are pinned to what Roslyn reports when it compiles the fixture.
const fixture = join(fixtureRoot, 'gates/directive-spans.rejected.cs');
const codes = new Set(['CS1529', 'CS1634', 'CS1695', 'CS1633']);

test('#pragma and misplaced-using diagnostics have the codes, severities and spans Roslyn reports', () => {
  const text = readFileSync(fixture, 'utf8'),
    recorded = JSON.parse(readFileSync(fixture + '.roslyn.json', 'utf8'));
  const theirs = recorded.errors.filter(entry => codes.has(entry[0])).map(entry => `${entry[0]}@${entry[1]}..${entry[2]} ${entry[3] ?? 'error'}`);
  const mine = SyntaxTree.parseText(text)
    .getDiagnostics()
    .filter(diagnostic => codes.has(diagnostic.code))
    .map(diagnostic => `${diagnostic.code}@${diagnostic.start}..${diagnostic.start + diagnostic.length} ${diagnostic.severity}`);
  assert.equal(theirs.length, 7);
  assert.deepEqual(mine, theirs);
});

test('#pragma warning enable is not a pragma: CS1634 at the word', () => {
  const source = '#pragma warning enable 168\nclass C { }\n';
  assert.deepEqual(diagnosticsOf(source), ['CS1634@16 "enable"']);
  const [directive] = SyntaxTree.parseText(source).directives;
  assert.equal(directive.structure.action, null);
  assert.deepEqual(diagnosticsOf('#pragma warning disable 168\n#pragma warning restore 168\nclass C { }\n'), []);
  assert.equal(languageFeature('PragmaWarningEnable'), undefined, 'the catalog no longer lists a feature Roslyn does not have');
});

test('CS1529 covers the whole misplaced using directive', () => {
  assert.deepEqual(diagnosticsOf('class A { }\nusing System.IO;\n'), ['CS1529@12 "using System.IO;"']);
});

test('await using records asynchronous using, await foreach records async streams', () => {
  const featuresOf = body => SyntaxTree.parseText(`class C { async void M() { ${body} } }`).features.map(use => use.id);
  assert.deepEqual(featuresOf('await using (r) { }').filter(id => id.startsWith('Async')), ['Async', 'AsyncUsing'], 'the async method and the using');
  assert(featuresOf('await using var s = F();').includes('AsyncUsing'));
  assert(!featuresOf('await using var s = F();').includes('AsyncStreams'));
  assert(featuresOf('await foreach (var x in xs) { }').includes('AsyncStreams'));
  assert.deepEqual(diagnosticsOf('class C { async void M() { await using (r) { } } }', '7.3'), ['CS8370@27 "await"']);
});
