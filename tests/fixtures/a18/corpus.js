import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SourceText} from '@sharpforge/text';
import {lex} from '@sharpforge/syntax';
import {
  analyzeDesignSources, designSourceSnapshot, DesignDocument, planDesignSourceUpdate,
} from '@sharpforge/designer';

export const corpusManifest = JSON.parse(readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'));
export const apiContract = JSON.parse(readFileSync(new URL('./api-contract.json', import.meta.url), 'utf8'));
export const corpusFixtures = Object.freeze(corpusManifest.fixtures);

export function corpusSourceInventory() {
  return readdirSync(new URL('./corpus/', import.meta.url), {withFileTypes: true})
    .filter(entry => entry.isDirectory()).flatMap(directory =>
      readdirSync(new URL('./corpus/' + directory.name + '/', import.meta.url))
        .filter(name => name.endsWith('.cs')).map(name => directory.name + '/' + name)).sort();
}

/** Fixture files are immutable input bytes, including CRLF, Unicode, and missing final newlines. */
export function loadFixture(fixture) {
  return fixture.files.map(file => ({
    uri: file.uri,
    text: readFileSync(new URL('./corpus/' + file.path, import.meta.url), 'utf8'),
    version: 7,
    ...(fixture.readOnly ? {readOnly: true} : {}),
  }));
}

export function analyzeFixture(fixture, sources = loadFixture(fixture), options = {}) {
  return analyzeDesignSources(sources, {
    uri: fixture.entry, className: 'View', methodName: 'Create', ...options,
  });
}

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

/** Node declaration order is incidental; child order, IDs, types, and every value are semantic. */
export function canonicalDocument(document) {
  return canonical({...document, nodes: [...document.nodes].sort((left, right) => left.id.localeCompare(right.id))});
}

function tokenTexts(text) {
  return lex(new SourceText(text, 'diff.cs')).tokens
    .filter(token => token.kind !== 'eof').map(token => token.syntaxKind + '\0' + token.text);
}

/** Counts removed plus inserted tokens in the minimal common-prefix/common-suffix replacement. */
export function changedTokenCount(before, after) {
  const oldTokens = tokenTexts(before);
  const newTokens = tokenTexts(after);
  let prefix = 0;
  while (prefix < oldTokens.length && prefix < newTokens.length && oldTokens[prefix] === newTokens[prefix]) prefix++;
  let suffix = 0;
  while (suffix < oldTokens.length - prefix && suffix < newTokens.length - prefix
    && oldTokens.at(-suffix - 1) === newTokens.at(-suffix - 1)) suffix++;
  return oldTokens.length + newTokens.length - 2 * (prefix + suffix);
}

function classificationCounts(regions) {
  const counts = {designer: 0, handwritten: 0};
  for (const region of regions) counts[region.kind] = (counts[region.kind] ?? 0) + 1;
  return counts;
}

/** Deterministic golden projection excludes compiler object graphs and environment-dependent timings. */
export function analysisGolden(fixture, analysis, sources = loadFixture(fixture)) {
  const snapshot = designSourceSnapshot(analysis);
  return canonical({
    fixture: fixture.id,
    category: fixture.category,
    sources: sources.map(file => ({uri: file.uri, sha256: sha256(file.text)})),
    accepted: true,
    entry: {uri: analysis.uri, className: analysis.ownership.className, methodName: analysis.method.name},
    ownership: classificationCounts(analysis.ownership.regions),
    protectedStatements: analysis.unmanaged.length,
    unsupportedConstructs: [
      ...analysis.unmanaged.map(({statement, message}) => ({
        kind: 'handwritten', syntaxKind: statement.kind, uri: statement.uri,
        span: {start: statement.start, end: statement.end}, message,
      })),
      ...analysis.warnings.map(warning => ({
        kind: 'protected', code: warning.code, node: warning.node ?? null,
        property: warning.property ?? null, message: warning.message,
      })),
    ],
    structuralEditable: analysis.structuralEditable,
    compilationSucceeded: analysis.compilationSucceeded,
    diagnostics: snapshot.diagnostics.map(item => ({
      code: item.code, legacyCode: item.legacyCode ?? null, severity: item.severity,
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    identity: Object.values(analysis.bindings).map(binding => ({
      designId: binding.id, variable: binding.name, uri: binding.uri,
      declaration: binding.declaration ?? null, field: binding.field,
    })).sort((left, right) => left.designId.localeCompare(right.designId)),
    document: canonicalDocument(analysis.document),
  });
}

export function rejectedGolden(fixture, error, sources = loadFixture(fixture)) {
  return {
    fixture: fixture.id, accepted: false, code: error.code,
    sources: sources.map(file => ({uri: file.uri, sha256: sha256(file.text)})),
  };
}

export function loadGolden(fixture) {
  return JSON.parse(readFileSync(new URL('./corpus/' + fixture.id + '/golden.json', import.meta.url), 'utf8'));
}

/** Explicit expectations are handwritten acceptance assertions, independent of recorded golden outputs. */
export function assertExpectedAnalysis(fixture, analysis) {
  assert.equal(analysis.compilationSucceeded, fixture.expected.compilationSucceeded,
    fixture.id + ': ' + JSON.stringify(analysis.compilerDiagnostics));
  assert.equal(analysis.structuralEditable, fixture.expected.structuralEditable, fixture.id);
  assert.deepEqual(analysis.document.nodes.map(node => node.id).sort(), [...fixture.expected.nodeIds].sort(), fixture.id);
  for (const binding of Object.values(analysis.bindings)) {
    assert.ok(binding.uri && binding.name, fixture.id + ': missing source identity');
    assert.ok(analysis.document.nodes.some(node => node.id === binding.id), fixture.id + ': missing design identity');
  }
}

/** A scalar edit must alter one source file, one mapped expression, and no unedited byte range. */
export function scalarEdit(fixture, analysis) {
  const edit = fixture.edit;
  const document = new DesignDocument(analysis.document);
  document.setProperty(edit.property, edit.value, [edit.node]);
  const plan = planDesignSourceUpdate(analysis, document.value, analysis.sources, {
    requireCompilation: fixture.expected.compilationSucceeded,
  });
  assert.equal(plan.changes.length, 1, fixture.id);
  assert.equal(plan.edits.length, 1, fixture.id);
  const [patch] = plan.edits;
  assert.equal(plan.text, analysis.text.slice(0, patch.start) + patch.text + analysis.text.slice(patch.end), fixture.id);
  assert.ok(changedTokenCount(analysis.text, plan.text) <= edit.tokenBudget, fixture.id + ': token budget');
  assert.equal(plan.document.nodes.find(node => node.id === edit.node).properties[edit.property], edit.value);
  for (const node of analysis.document.nodes) assert.ok(plan.document.nodes.some(candidate => candidate.id === node.id));
  return plan;
}
