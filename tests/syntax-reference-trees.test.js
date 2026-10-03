import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { matchesGrammar, isNodeKind, isTokenKind, isTriviaKind } from '@sharpforge/syntax';
import { fixtureRoot, filesUnder, loadReferenceFixture, compareWithReference } from './support/syntax-reference.js';

// SF-A01-T01.5 / T05 / T06: every fixture with a pinned Roslyn dump must produce the same tree - node and token kinds,
// spans, trivia attachment, token values and error codes. Preview syntax the pinned Roslyn build does not parse has no dump.
const fixtures = filesUnder(fixtureRoot).filter(file => existsSync(file + '.json'));
test('reference: fixtures and dumps are present and pinned to one Roslyn build', () => {
  assert(fixtures.length >= 100, `expected at least 100 reference fixtures, found ${fixtures.length}`);
  const versions = new Set(fixtures.map(file => JSON.parse(readFileSync(file + '.json', 'utf8')).roslyn));
  assert.equal(versions.size, 1); assert.match([...versions][0], /^\d+\.\d+\.\d+.*\+[0-9a-f]{40}$/, 'dump records the Roslyn version and commit hash');
  assert.equal(JSON.parse(readFileSync(join(fixtureRoot, 'reference/roslyn-features.json'), 'utf8')).roslyn, [...versions][0]);
});
for (const file of fixtures) test('reference: tree equals Roslyn for ' + file.slice(fixtureRoot.length + 1), () => {
  const { text, tree, reference } = loadReferenceFixture(file);
  assert.equal(reference.length, text.length, 'dump was generated from this fixture text');
  assert.equal(tree.toFullString(), text); assert(matchesGrammar(tree.green), 'every node has the child slots its grammar entry declares');
  assert.deepEqual(compareWithReference(tree, reference, text), []);
});
test('reference: every kind used by the Roslyn dumps exists in SyntaxKind', () => {
  const unknown = new Set();
  const visit = node => { if (Array.isArray(node[3])) { if (!isNodeKind(node[0])) unknown.add(node[0]); node[3].forEach(visit); } else { if (!isTokenKind(node[0])) unknown.add(node[0]); for (const trivia of [...node[6], ...node[7]]) if (!isTriviaKind(trivia[0])) unknown.add(trivia[0]); } };
  for (const file of fixtures) visit(JSON.parse(readFileSync(file + '.json', 'utf8')).tree);
  assert.deepEqual([...unknown], []);
});
