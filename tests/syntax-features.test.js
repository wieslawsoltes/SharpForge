import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { languageFeatures, languageFeature, previousLanguageVersion, parseLanguageVersion, languageVersion, languageVersionDiagnostic, displayLanguageVersion, featureAvailability, checkFeature, checkFeatures, previewRevisions, SyntaxTree, parse } from '@sharpforge/syntax';
import { languageVersion as compilerLanguageVersion, compile } from '@sharpforge/compiler';
import { SourceText } from '@sharpforge/text';
import { fixtureRoot, filesUnder, repoRoot } from './support/syntax-reference.js';

// SF-A01-T01.1: the feature catalog.
test('features: catalog has unique ids, a version on every row and at least 250 rows', () => {
  assert(languageFeatures.length >= 250, String(languageFeatures.length));
  assert.equal(new Set(languageFeatures.map(f => f.id)).size, languageFeatures.length);
  const versions = new Set([1, 2, 3, 4, 5, 6, 7, 7.1, 7.2, 7.3, 8, 9, 10, 11, 12, 13, 14, 15]);
  for (const row of languageFeatures) {
    assert(versions.has(row.version), row.id); assert(row.name.length > 0, row.id); assert.equal(row.preview, row.version === 15);
    assert(row.version === 1 ? row.code === null : /^CS\d{4}$/.test(row.code), row.id + ' ' + row.code);
    assert(row.messageId === null || row.messageId === 'IDS_Feature' + row.id);
  }
  for (const version of versions) assert(languageFeatures.some(f => f.version === version), 'no feature for C# ' + version);
});
test('features: every Roslyn MessageID feature is catalogued with the same required version', () => {
  const roslyn = JSON.parse(readFileSync(join(fixtureRoot, 'reference/roslyn-features.json'), 'utf8')).features, byMessage = new Map(languageFeatures.filter(f => f.messageId).map(f => [f.messageId, f]));
  assert(roslyn.length > 150);
  for (const [name, version] of roslyn) { const row = byMessage.get(name); assert(row, 'missing ' + name); assert.equal(row.version, Number(version), name); }
  assert.deepEqual([...byMessage.keys()].filter(id => !roslyn.some(([name]) => name === id)), [], 'no invented MessageIDs');
});
test('features: compiler and syntax share one LangVersion parser and table', () => {
  assert.deepEqual(compilerLanguageVersion('7.3'), languageVersion('7.3'));
  assert.deepEqual(compilerLanguageVersion('preview'), { name: 'preview', number: 15, preview: true });
  assert.equal(compile('Console.WriteLine(1);', { langVersion: 'nonsense' }).diagnostics.some(d => d.code === 'SF2140'), true);
  assert.equal(compile('Console.WriteLine(1);', { langVersion: '7.2' }).success, true);
});
// SF-A01-T01.2: LangVersion spellings.
test('langversion: all Roslyn spellings map correctly and minor versions are distinct', () => {
  const expected = { 1: 1, '1.0': 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, '7.0': 7, '7.1': 7.1, '7.2': 7.2, '7.3': 7.3, 8: 8, '8.0': 8, 9: 9, 10: 10, 11: 11, 12: 12, 13: 13, 14: 14, '14.0': 14, 'ISO-1': 1, 'iso-2': 2, default: 14, Latest: 14, latestMajor: 14, LATESTMAJOR: 14 };
  for (const [text, number] of Object.entries(expected)) assert.deepEqual(parseLanguageVersion(text), { name: text.toLowerCase(), number, preview: false }, text);
  assert.deepEqual(parseLanguageVersion('preview'), { name: 'preview', number: 15, preview: true }); assert.deepEqual(parseLanguageVersion(undefined).number, 14);
  assert.notEqual(parseLanguageVersion('7.1').number, parseLanguageVersion('7.2').number); assert.notEqual(parseLanguageVersion('7.3').number, parseLanguageVersion('7').number);
  assert.equal(displayLanguageVersion(7.3), '7.3'); assert.equal(displayLanguageVersion(8), '8.0'); assert.equal(displayLanguageVersion(5), '5'); assert.equal(displayLanguageVersion(15), 'preview');
});
test('langversion: invalid values report CS1617', () => {
  for (const bad of ['0', '15', '7.4', '8.1', '6.5', 'iso-3', 'newest', '', 'C#9', '9.0.1', '-1']) {
    assert.equal(parseLanguageVersion(bad), null, bad); assert.throws(() => languageVersion(bad), error => error.code === 'CS1617');
    assert.equal(languageVersionDiagnostic(bad).code, 'CS1617');
  }
  const tree = SyntaxTree.parseText('class C { }', { languageVersion: 'bogus' });
  assert.deepEqual(tree.getDiagnostics().map(d => d.code), ['CS1617']); assert.match(tree.getDiagnostics()[0].message, /bogus/);
});
// SF-A01-T01.3: the feature gate.
test('feature gate: code depends on the selected version and matches the catalog row', () => {
  const codes = { 1: 'CS8022', 2: 'CS8023', 3: 'CS8024', 4: 'CS8025', 5: 'CS8026', 6: 'CS8059', 7: 'CS8107', 7.1: 'CS8302', 7.2: 'CS8320', 7.3: 'CS8370', 8: 'CS8400', 9: 'CS8773', 10: 'CS8936', 11: 'CS9058', 12: 'CS9202', 13: 'CS9260' };
  for (const row of languageFeatures) {
    if (row.preview) { assert.equal(featureAvailability(row.id, 'preview'), null); assert.equal(featureAvailability(row.id, '14').code, 'CS8652'); continue; }
    assert.equal(featureAvailability(row.id, String(row.version)), null, row.id); assert.equal(featureAvailability(row.id, 'latest'), null, row.id);
    const previous = previousLanguageVersion(row.version); if (previous === null) continue;
    const result = featureAvailability(row.id, String(previous));
    assert.equal(result.code, row.code, row.id); assert.equal(result.code, codes[previous], row.id);
    assert.match(result.message, new RegExp(`is not available in C# ${displayLanguageVersion(previous).replace('.', '\\.')}\\. Please use language version ${displayLanguageVersion(row.version).replace('.', '\\.')} or greater`));
  }
  assert.equal(featureAvailability('Generics', '1').code, 'CS8022'); assert.equal(featureAvailability('RawStringLiterals', '7.3').code, 'CS8370'); assert.equal(featureAvailability('RawStringLiterals', '9').code, 'CS8773');
  assert.throws(() => featureAvailability('NoSuchFeature', '9'), /Unknown language feature/);
});
test('feature gate: checkFeature reports the node span and checkFeatures the recorded uses', () => {
  const source = new SourceText('class C { void M() { a ??= b; } }'), tree = SyntaxTree.parseText(source), token = [...tree.root.descendantTokens()].find(t => t.text === '??=');
  assert.deepEqual(checkFeature(token, 'CoalesceAssignmentExpression', '7.3'), { code: 'CS8370', message: "Feature 'coalescing assignment' is not available in C# 7.3. Please use language version 8.0 or greater.", start: 23, end: 26 });
  assert.equal(checkFeature(token, 'CoalesceAssignmentExpression', '8'), null);
  const diagnostics = checkFeatures(source, tree.features, '7.3'); assert.deepEqual(diagnostics.map(d => [d.code, d.start, d.length]), [['CS8370', 23, 3]]);
  assert.deepEqual(parse(source, undefined, { languageVersion: '7.3' }).diagnostics.map(d => d.code), ['CS8370']); assert.deepEqual(parse(source).diagnostics, []);
});
test('feature gate: every feature id recorded by the lexer and parser is catalogued', () => {
  const used = new Set();
  for (const file of filesUnder(join(repoRoot, 'packages/syntax/src'), name => name.endsWith('.js'))) for (const match of readFileSync(file, 'utf8').matchAll(/feature\('([A-Za-z0-9]+)'|features\.push\('([A-Za-z0-9]+)'|functionBody\('([A-Za-z0-9]+)'|\? '(ObjectInitializer)' : '(CollectionInitializer)'|\? '(StringEscapeCharacter)'/g)) for (const id of match.slice(1)) if (id) used.add(id);
  assert(used.size > 80, String(used.size));
  for (const id of used) assert(languageFeature(id), 'uncatalogued feature ' + id);
});
// SF-A01-T01.6: preview revision stamps.
test('preview: every preview feature carries a revision stamp and diagnostics print it', () => {
  const preview = languageFeatures.filter(f => f.preview); assert(preview.length >= 2);
  for (const row of preview) {
    const stamp = previewRevisions[row.id]; assert(stamp, 'preview feature without a revision stamp: ' + row.id);
    assert.match(stamp.proposal, /^csharplang\/proposals\//); assert(Number.isInteger(stamp.revision)); assert.match(stamp.sdk, /SDK \d+\.\d+\.\d+ \(Roslyn .*\+[0-9a-f]{40}\)/);
    const result = featureAvailability(row.id, '14'); assert(result.message.includes(stamp.proposal) && result.message.includes('revision ' + stamp.revision));
  }
  assert.deepEqual(Object.keys(previewRevisions).filter(id => !languageFeature(id)?.preview), [], 'stamps only for preview features');
  const tree = SyntaxTree.parseText('outer: while (true) { break outer; }', { languageVersion: '14' });
  assert.equal(tree.getDiagnostics()[0].code, 'CS8652'); assert.match(tree.getDiagnostics()[0].message, /labeled-break-continue\.md revision 1/);
});
