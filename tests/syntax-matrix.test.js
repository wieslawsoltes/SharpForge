import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { languageFeatures, languageFeature, previousLanguageVersion, SyntaxTree } from '@sharpforge/syntax';
import { fixtureRoot, filesUnder, fixtureOptions, repoRoot } from './support/syntax-reference.js';
import { featureSnippets } from '../packages/compiler/test/conformance/feature-snippets.js';

// SF-A01-T01.3 / T01.4: the C# 1-15 syntax matrix. packages/syntax/test/matrix/<version>/<feature>/ holds positive.cs
// (parses cleanly at the introducing version and records the feature) and rejected.cs (the same text one version too
// low, with the expected code and span in its first line). rejected.cs.roslyn.json beside it is what Roslyn reports
// when it compiles rejected.cs at that version, so the expectation is checked against the reference compiler.
//
// A catalog row is syntax-gated when the lexer or parser records it. Every syntax-gated row must have both fixtures.
// The other rows are listed in the conformance report without a fixture: C# 1 rows have no version below them
// (gate 'none'); the rest are gated by the compiler (gate 'compiler'), either by its syntax walker or while binding,
// and are verified row by row in tests/compiler-feature-gate-matrix.test.js, whose snippet table must cover them.
const matrix = join(fixtureRoot, 'matrix');
const directoryOf = row => join(matrix, row.preview ? '15-preview' : String(row.version), row.id);
const versionOf = row => (row.preview ? 'preview' : String(row.version));
const belowOf = row => (row.preview ? '14' : String(previousLanguageVersion(row.version)));
const read = file => readFileSync(file, 'utf8');
const header = /^\/\/ langversion (\S+): expect (CS\d{4}) at (\d+) (".*")\n/;

/** The ids of the features recorded when `text` is parsed without a language version (everything allowed). */
function recordedFeatures(text, options = {}) {
  return new Set(SyntaxTree.parseText(text, { ...options, languageVersion: undefined }).features.map(use => use.id));
}
// Every feature the parser records for any fixture of the package: these are the syntax-gated rows.
const syntaxGated = new Set();
for (const file of filesUnder(fixtureRoot)) {
  const text = read(file);
  for (const id of recordedFeatures(text, fixtureOptions(text))) syntaxGated.add(id);
}

test('matrix: every syntax-gated catalog row has a positive and a rejected fixture', () => {
  const missing = [];
  for (const row of languageFeatures) {
    const directory = directoryOf(row),
      positive = existsSync(join(directory, 'positive.cs')),
      rejected = existsSync(join(directory, 'rejected.cs'));
    if (syntaxGated.has(row.id) && row.version > 1 && !(positive && rejected)) missing.push(row.id);
    if (positive !== rejected) missing.push(row.id + ' (incomplete pair)');
  }
  assert.deepEqual(missing, []);
  for (const id of syntaxGated) assert(languageFeature(id), `the parser records '${id}', which is not a catalog row`);
  const known = new Set(languageFeatures.map(row => directoryOf(row)));
  for (const file of filesUnder(matrix)) assert(known.has(join(file, '..')), 'fixture for an uncatalogued feature: ' + file);
});

/** Asserts that the positive fixture parses cleanly from its version on and records the feature. */
function assertAccepted(row, positive) {
  for (const accepted of [versionOf(row), 'latest', 'preview']) {
    if (row.preview && accepted === 'latest') continue;
    const tree = SyntaxTree.parseText(positive, { languageVersion: accepted });
    assert.deepEqual(
      tree.getDiagnostics().map(d => d.code + ' ' + d.message),
      [],
      accepted
    );
    assert.equal(tree.toFullString(), positive);
  }
  assert(recordedFeatures(positive).has(row.id), `positive.cs does not use '${row.id}'`);
}

/** A feature whose syntax means something else below its version: it parses cleanly to a different tree. */
function assertOlderMeaning(row, positive, rejected) {
  const first = rejected.indexOf('\n') + 1;
  assert.match(rejected.slice(0, first), new RegExp(`^// langversion ${belowOf(row)}: expect an older meaning`));
  assert.equal(rejected.slice(first), positive, 'rejected.cs is the positive fixture plus the expectation line');
  const kindsAt = version => [...SyntaxTree.parseText(positive, { languageVersion: version }).root.descendantNodes()].map(node => node.kind);
  assert.deepEqual(SyntaxTree.parseText(positive, { languageVersion: belowOf(row) }).getDiagnostics(), []);
  assert.notDeepEqual(kindsAt(belowOf(row)), kindsAt(versionOf(row)));
}

/** Asserts the single diagnostic one version too low and returns { code, start, end } in rejected.cs coordinates. */
function assertRejected(row, positive, rejected) {
  const expectation = header.exec(rejected);
  assert(expectation, 'rejected.cs starts with its expectation');
  assert.equal(expectation[1], belowOf(row));
  assert.equal(expectation[2], row.code);
  assert.equal(rejected.slice(expectation[0].length), positive, 'rejected.cs is the positive fixture plus the expectation line');
  const span = JSON.parse(expectation[4]),
    diagnostics = SyntaxTree.parseText(rejected, { languageVersion: belowOf(row) }).getDiagnostics();
  assert.equal(diagnostics.length, 1, diagnostics.map(d => d.code + ' ' + d.message).join('; '));
  const [diagnostic] = diagnostics;
  assert.equal(diagnostic.code, row.code);
  assert.equal(diagnostic.severity, row.severity);
  assert.equal(rejected.slice(diagnostic.start, diagnostic.start + diagnostic.length), span);
  assert.equal(diagnostic.start - expectation[0].length, Number(expectation[3]), 'offset within the positive fixture');
  return { code: diagnostic.code, start: diagnostic.start, end: diagnostic.start + diagnostic.length };
}

/**
 * Roslyn can confirm every row except preview syntax that the pinned build predates. For the other rows Roslyn must
 * report the same code over the same span when it compiles rejected.cs (a zero-width Roslyn span, used for numeric
 * literals, is compared by its start). That includes rows without a Roslyn feature id of their own, such as top-level
 * statements, which Roslyn gates under another id.
 */
const roslynKnows = row => !row.preview;
function assertRoslynAgrees(directory, expected) {
  const recorded = JSON.parse(read(join(directory, 'rejected.cs.roslyn.json')));
  const agrees = recorded.errors.some(
    ([code, start, end]) => code === expected.code && start === expected.start && (end === expected.end || end === start)
  );
  const reported = recorded.errors.map(entry => entry.slice(0, 3).join(':')).join(' ');
  assert(agrees, `Roslyn ${recorded.roslyn} reports [${reported}], not ${expected.code}:${expected.start}:${expected.end}`);
}

const report = { generated: 'tests/syntax-matrix.test.js', rows: [] };
for (const row of languageFeatures) {
  const directory = directoryOf(row);
  if (!existsSync(join(directory, 'positive.cs'))) {
    const gate = row.version === 1 ? 'none' : syntaxGated.has(row.id) ? 'syntax' : 'compiler';
    report.rows.push({ id: row.id, version: row.version, gate, status: 'no-fixture' });
    continue;
  }
  const entry = { id: row.id, version: row.version, gate: 'syntax', code: row.code, roslyn: 'not-applicable', status: 'failed' };
  report.rows.push(entry);
  test(`matrix: ${versionOf(row)}/${row.id} is accepted at C# ${versionOf(row)} and rejected at C# ${belowOf(row)} with ${row.code}`, () => {
    const positive = read(join(directory, 'positive.cs')),
      rejected = read(join(directory, 'rejected.cs'));
    assertAccepted(row, positive);
    if (row.olderMeaning) assertOlderMeaning(row, positive, rejected);
    else {
      const expected = assertRejected(row, positive, rejected);
      if (roslynKnows(row)) {
        assertRoslynAgrees(directory, expected);
        entry.roslyn = 'agrees';
      }
    }
    entry.status = 'passed';
  });
}

test('matrix: conformance report is emitted as JSON', () => {
  const rows = report.rows,
    summary = {
      fixtures: rows.filter(r => r.status !== 'no-fixture').length,
      passed: rows.filter(r => r.status === 'passed').length,
      roslynAgrees: rows.filter(r => r.roslyn === 'agrees').length,
      compilerGated: rows.filter(r => r.gate === 'compiler').length,
      firstVersion: rows.filter(r => r.gate === 'none').length,
      total: rows.length
    };
  assert.equal(summary.total, languageFeatures.length);
  assert.equal(summary.passed, summary.fixtures);
  assert.equal(summary.fixtures + summary.compilerGated + summary.firstVersion, summary.total, 'every row is in exactly one group');
  for (const row of rows.filter(r => r.gate === 'compiler')) assert(row.id in featureSnippets, `${row.id} has no snippet in the compiler gate matrix`);
  assert(summary.fixtures >= 125, String(summary.fixtures));
  assert(summary.roslynAgrees >= 118, String(summary.roslynAgrees));
  const directory = join(repoRoot, 'artifacts');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'syntax-matrix-conformance.json'), JSON.stringify({ ...report, summary }, null, 1) + '\n');
  assert.equal(JSON.parse(read(join(directory, 'syntax-matrix-conformance.json'))).summary.total, languageFeatures.length);
});
