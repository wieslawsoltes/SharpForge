import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SyntaxTree } from '@sharpforge/syntax';
import { assertMatchesRoslyn, diagnosticsOf, fixtureRoot } from './support/syntax-reference.js';

// Defect reported by the compiler workstream: CS1525 for `throw` used as an operand that binds tighter than `??`
// covered only the keyword. Roslyn attaches the error to the throw expression, so the span runs to the end of its operand.
const fixture = join(fixtureRoot, 'gates/throw-operand.rejected.cs');
const inMethod = body => `class C { void M() { ${body} } }`;

test('CS1525 for throw as an operand has the span Roslyn reports', () => {
  const text = readFileSync(fixture, 'utf8'),
    recorded = JSON.parse(readFileSync(fixture + '.roslyn.json', 'utf8'));
  const theirs = recorded.errors.filter(entry => entry[0] === 'CS1525').map(entry => `${entry[1]}..${entry[2]} ${text.slice(entry[1], entry[2])}`);
  const mine = SyntaxTree.parseText(text, { languageVersion: recorded.langversion })
    .getDiagnostics()
    .filter(diagnostic => diagnostic.code === 'CS1525')
    .map(diagnostic => `${diagnostic.start}..${diagnostic.start + diagnostic.length} ${text.slice(diagnostic.start, diagnostic.start + diagnostic.length)}`);
  assert.equal(theirs.length, 8);
  assert.deepEqual(mine, theirs);
});

test('the tree for throw as an operand matches Roslyn', () => {
  const { tree, kinds } = assertMatchesRoslyn('reference/csharp7/throw-operand.cs');
  assert(kinds.has('ThrowExpression'));
  assert.deepEqual([...new Set(tree.getDiagnostics().map(diagnostic => diagnostic.code))], ['CS1525']);
});

test('the span covers the throw expression: its keyword and the operand parsed with it', () => {
  assert.deepEqual(diagnosticsOf(inMethod('var b = a + throw e;')), ['CS1525@33 "throw e"']);
  assert.deepEqual(diagnosticsOf(inMethod('var b = a * throw e + 1;')), ['CS1525@33 "throw e + 1"']);
  assert.deepEqual(diagnosticsOf(inMethod('var b = -throw new E(1);')), ['CS1525@30 "throw new E(1)"']);
  assert.deepEqual(diagnosticsOf(inMethod('var b = a ?? throw e;')), [], 'the right operand of ?? is a legal position');
});
