import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { languageFeatures, previousLanguageVersion, SyntaxTree } from '@sharpforge/syntax';
import { fixtureRoot, filesUnder, repoRoot } from './support/syntax-reference.js';

// SF-A01-T01.4: the C# 1-15 syntax matrix. packages/syntax/test/matrix/<version>/<feature>/ holds positive.cs (parses
// cleanly at the introducing version) and rejected.cs (the same construct one version too low, with the expected code and
// span in its first line). Every feature the lexer or parser records must have both fixtures; rows that only the binder
// can gate are listed in the conformance report as not syntax-gated.
const matrix = join(fixtureRoot, 'matrix'), directoryOf = row => join(matrix, row.preview ? '15-preview' : String(row.version), row.id);
const recorded = new Set();
for (const file of filesUnder(join(repoRoot, 'packages/syntax/src'), name => name.endsWith('.js'))) for (const match of readFileSync(file, 'utf8').matchAll(/feature\('([A-Za-z0-9]+)'|features\.push\('([A-Za-z0-9]+)'|functionBody\('([A-Za-z0-9]+)'|\? '(ObjectInitializer)' : '(CollectionInitializer)'|\? '(StringEscapeCharacter)'/g)) for (const id of match.slice(1)) if (id) recorded.add(id);
const report = { generated: 'tests/syntax-matrix.test.js', rows: [] };
test('matrix: every parser-gated catalog row has a positive and a rejected fixture', () => {
  const missing = [];
  for (const row of languageFeatures) {
    const gated = recorded.has(row.id) && row.version > 1, directory = directoryOf(row), positive = existsSync(join(directory, 'positive.cs')), rejected = existsSync(join(directory, 'rejected.cs'));
    if (gated && !(positive && rejected)) missing.push(row.id);
    if (positive !== rejected) missing.push(row.id + ' (incomplete pair)');
  }
  assert.deepEqual(missing, []);
  const known = new Set(languageFeatures.map(row => directoryOf(row)));
  for (const file of filesUnder(matrix)) assert(known.has(join(file, '..')), 'fixture for an uncatalogued feature: ' + file);
});
for (const row of languageFeatures) {
  const directory = directoryOf(row); if (!existsSync(join(directory, 'positive.cs'))) { report.rows.push({ id: row.id, version: row.version, gate: recorded.has(row.id) ? 'syntax' : 'binder', status: 'no-fixture' }); continue; }
  const version = row.preview ? 'preview' : String(row.version), previous = row.preview ? '14' : String(previousLanguageVersion(row.version)), entry = { id: row.id, version: row.version, gate: 'syntax', code: row.code, status: 'failed' }; report.rows.push(entry);
  test(`matrix: ${version}/${row.id} is accepted at C# ${version} and rejected at C# ${previous} with ${row.code}`, () => {
    const positive = readFileSync(join(directory, 'positive.cs'), 'utf8'), rejected = readFileSync(join(directory, 'rejected.cs'), 'utf8');
    for (const accepted of [version, 'latest', 'preview']) { if (row.preview && accepted === 'latest') continue; const tree = SyntaxTree.parseText(positive, { languageVersion: accepted }); assert.deepEqual(tree.getDiagnostics().map(d => d.code + ' ' + d.message), [], accepted); assert.equal(tree.toFullString(), positive); }
    if (row.olderMeaning) {
      // Below its version this syntax means something else, so it parses cleanly to a different tree instead of being rejected.
      const first = rejected.indexOf('\n') + 1; assert.match(rejected.slice(0, first), new RegExp(`^// langversion ${previous}: expect an older meaning`)); assert.equal(rejected.slice(first), positive);
      const older = SyntaxTree.parseText(positive, { languageVersion: previous }), newer = SyntaxTree.parseText(positive, { languageVersion: version });
      assert.deepEqual(older.getDiagnostics(), []); assert.notDeepEqual([...older.root.descendantNodes()].map(n => n.kind), [...newer.root.descendantNodes()].map(n => n.kind));
      entry.status = 'passed'; return;
    }
    const header = /^\/\/ langversion (\S+): expect (CS\d{4}) at (\d+) (".*")\n/.exec(rejected); assert(header, 'rejected.cs starts with its expectation');
    assert.equal(header[1], previous); assert.equal(header[2], row.code); assert.equal(rejected.slice(header[0].length), positive, 'rejected.cs is the positive fixture plus the expectation line');
    const span = JSON.parse(header[4]), diagnostics = SyntaxTree.parseText(rejected, { languageVersion: previous }).getDiagnostics();
    assert.equal(diagnostics.length, 1, diagnostics.map(d => d.code + ' ' + d.message).join('; '));
    assert.equal(diagnostics[0].code, row.code); assert.equal(rejected.slice(diagnostics[0].start, diagnostics[0].start + diagnostics[0].length), span);
    assert.equal(diagnostics[0].start - header[0].length, Number(header[3]), 'offset within the positive fixture');
    entry.status = 'passed';
  });
}
test('matrix: conformance report is emitted as JSON', () => {
  const summary = { fixtures: report.rows.filter(r => r.status !== 'no-fixture').length, passed: report.rows.filter(r => r.status === 'passed').length, binderGated: report.rows.filter(r => r.gate === 'binder').length, total: report.rows.length };
  assert.equal(summary.total, languageFeatures.length); assert.equal(summary.passed, summary.fixtures); assert(summary.fixtures >= 90, String(summary.fixtures));
  const directory = join(repoRoot, 'artifacts'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'syntax-matrix-conformance.json'), JSON.stringify({ ...report, summary }, null, 1) + '\n');
  assert.equal(JSON.parse(readFileSync(join(directory, 'syntax-matrix-conformance.json'), 'utf8')).summary.total, languageFeatures.length);
});
