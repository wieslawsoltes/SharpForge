import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SyntaxTree, languageFeature } from '@sharpforge/syntax';
import { diagnosticsOf, fixtureRoot } from './support/syntax-reference.js';

// SF-A01-T01.3: two directives were gated by language version although Roslyn has no such gate.
//   #line (1, 2) - (3, 4) "f"   reported CS8773 below C# 10; Roslyn accepts it at every version.
//   #:package Example           reported CS9260 below C# 14; Roslyn reports CS9298 at every version when the file is
//                               not a file-based program, and nothing otherwise.
// Each fixture is compiled by Roslyn at the version named in its first line; every error must be the same.
function compare(relative, options = {}) {
  const file = join(fixtureRoot, relative),
    text = readFileSync(file, 'utf8'),
    recorded = JSON.parse(readFileSync(file + '.roslyn.json', 'utf8')),
    show = (code, start, end) => `${code}@${start}..${end} ${text.slice(start, end)}`;
  const theirs = recorded.errors.filter(entry => entry[3] !== 'warning').map(entry => show(entry[0], entry[1], entry[2]));
  const tree = SyntaxTree.parseText(text, { ...options, languageVersion: recorded.langversion });
  assert.equal(tree.toFullString(), text);
  assert.deepEqual(
    tree.getDiagnostics().map(diagnostic => show(diagnostic.code, diagnostic.start, diagnostic.start + diagnostic.length)),
    theirs,
    relative
  );
  return { tree, errors: theirs };
}

test('a #line span directive at C# 9 reports nothing, as in Roslyn', () => {
  const { tree, errors } = compare('gates/line-span-directive.rejected.cs');
  assert.deepEqual(errors, []);
  assert.deepEqual(
    tree.directives.map(directive => directive.kind),
    ['LineSpanDirectiveTrivia', 'LineSpanDirectiveTrivia', 'LineDirectiveTrivia']
  );
  for (const version of ['1', '9', '10', 'preview']) assert.deepEqual(diagnosticsOf('#line (1, 2) - (3, 4) "a.cs"\nclass C { }\n', version), [], version);
});

test('a malformed #line span is still reported at every version', () => {
  assert.deepEqual(diagnosticsOf('#line (3, 4) - (1, 2) "a.cs"\nclass C { }\n', '9').map(entry => entry.split('@')[0]), ['CS8939']);
});

test('#: outside a file-based program is CS9298 on the colon at C# 13, as in Roslyn, and not a language-version diagnostic', () => {
  const { errors } = compare('gates/ignored-directives.rejected.cs', { fileBasedProgram: false });
  assert.equal(errors.length, 2);
  assert(errors.every(entry => entry.startsWith('CS9298@') && entry.endsWith(' :')));
  const source = '#:package Example@1.0\nclass C { }\n';
  for (const version of ['13', '14', 'preview']) {
    const tree = SyntaxTree.parseText(source, { languageVersion: version, fileBasedProgram: false });
    assert.deepEqual(tree.getDiagnostics().map(diagnostic => diagnostic.code), ['CS9298'], version);
  }
});

test('#: in a file-based program reports nothing at any version', () => {
  const source = '#:package Example@1.0\nclass C { }\n';
  for (const version of ['13', '14', 'preview']) {
    const tree = SyntaxTree.parseText(source, { languageVersion: version, fileBasedProgram: true });
    assert.deepEqual(tree.getDiagnostics(), [], version);
    assert.deepEqual(tree.directives.map(directive => directive.kind), ['IgnoredDirectiveTrivia']);
  }
});

test('neither directive is recorded as a feature use; the catalog rows remain', () => {
  const uses = text => SyntaxTree.parseText(text).features.map(use => use.id);
  assert.deepEqual(uses('#line (1, 2) - (3, 4) "a.cs"\nclass C { }\n'), []);
  assert.deepEqual(uses('#:package Example@1.0\nclass C { }\n'), []);
  assert.equal(languageFeature('LineSpanDirective').version, 10);
  assert.equal(languageFeature('IgnoredDirectives').version, 14);
});
