import test from 'node:test';
import assert from 'node:assert/strict';
import {readDesignSource, planDesignSourceUpdate, CSharpDesignSession, DesignDocument} from '@sharpforge/designer';
import {corpusFixtures, corpusSourceInventory, loadFixture, analyzeFixture, loadGolden, canonical, scalarEdit} from './fixtures/a18/corpus.js';
import {qualifyFixture} from './fixtures/a18/report.js';

test('qualification corpus contains at least 40 independently stored accepted source fixtures', () => {
  assert.ok(corpusFixtures.filter(fixture => fixture.expected.accepted).length >= 40);
  assert.equal(new Set(corpusFixtures.map(fixture => fixture.id)).size, corpusFixtures.length);
  assert.deepEqual(corpusSourceInventory(), corpusFixtures.flatMap(fixture => fixture.files.map(file => file.path)).sort());
  const categories = new Set(corpusFixtures.map(fixture => fixture.category));
  for (const category of ['code-first', 'partial', 'generated', 'styles', 'templates', 'events', 'protected']) {
    assert.ok(categories.has(category), category);
  }
});

for (const fixture of corpusFixtures) {
  test(`qualification golden/no-churn/minimal-diff/VM identity: ${fixture.id}`, () => {
    const result = qualifyFixture(fixture);
    assert.deepEqual(canonical(result.golden), canonical(loadGolden(fixture)), fixture.id + ': unreviewed analysis regression');
    assert.notEqual(result.targets.nativeWinUI.status, 'passed');
    assert.notEqual(result.targets.browser.status, 'passed');
  });
}

test('an aborted corpus analysis and planner do not publish a design or source edit', () => {
  const fixture = corpusFixtures[0];
  const sources = loadFixture(fixture);
  const original = structuredClone(sources);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => analyzeFixture(fixture, sources, {signal: controller.signal}), error => error.code === 'SFSYNC_CANCELLED');
  const analysis = analyzeFixture(fixture, sources);
  assert.throws(() => planDesignSourceUpdate(analysis, analysis.document, sources, {signal: controller.signal}),
    error => error.code === 'SFSYNC_CANCELLED');
  assert.deepEqual(sources, original);
});

test('session disposal invalidates a completed corpus plan and preserves its recoverable baseline', () => {
  const fixture = corpusFixtures[0];
  const [source] = loadFixture(fixture);
  const session = new CSharpDesignSession(source.text, {uri: source.uri, className: 'View', methodName: 'Create'});
  const document = new DesignDocument(session.document);
  document.setProperty('Width', 211, ['action']);
  const plan = session.plan(document.value, source.text, {requireCompilation: true});
  session.dispose();
  assert.throws(() => session.commit(plan), error => error.code === 'SFSYNC_CANCELLED');
  assert.equal(session.analysis.text, source.text);
  document.dispose();
});

test('limits accept the exact source and node budget and reject the next smaller budget atomically', () => {
  const fixture = corpusFixtures[0];
  const sources = loadFixture(fixture);
  const length = sources[0].text.length;
  assert.equal(analyzeFixture(fixture, sources, {maxBytes: length, maxTotalBytes: length, maxNodes: 3}).document.nodes.length, 3);
  for (const options of [{maxBytes: length - 1}, {maxTotalBytes: length - 1}, {maxNodes: 2}]) {
    assert.throws(() => analyzeFixture(fixture, sources, options), error => error.code === 'SFSYNC_LIMIT');
  }
});

test('protected factories reject structural edits and retain handwritten statements byte-for-byte', () => {
  const fixture = corpusFixtures.find(candidate => candidate.id === '41-unsupported-factory');
  const analysis = analyzeFixture(fixture);
  const document = new DesignDocument(analysis.document);
  document.add('TextBlock', 'root', {Text: 'Unsafe replacement'});
  assert.throws(() => planDesignSourceUpdate(analysis, document.value), error => error.code === 'SFSYNC_OWNERSHIP');
  const scalar = scalarEdit(fixture, analysis);
  assert.ok(scalar.text.includes('Button action = BuildButton();'));
  assert.ok(scalar.text.includes('static Button BuildButton() { return new Button'));
});

test('malformed editor text cannot replace a synchronized corpus preview', () => {
  const fixture = corpusFixtures[0];
  const [source] = loadFixture(fixture);
  const session = new CSharpDesignSession(source.text, {uri: source.uri, className: 'View', methodName: 'Create'});
  const preview = session.document;
  assert.throws(() => session.read(source.text.replace('new Window()', 'new Window(')), error => error.code === 'SFSYNC_PARSE');
  assert.deepEqual(session.document, preview);
  assert.equal(session.analysis.text, source.text);
  session.dispose();
});

test('golden source IDs survive a source rename independent of C# Name property and preserve runtime names', () => {
  const fixture = corpusFixtures[0];
  const analysis = analyzeFixture(fixture);
  const renamed = readDesignSource(analysis.text.replaceAll('action', 'commandButton'), {
    uri: fixture.entry, className: 'View', methodName: 'Create', previous: analysis,
  });
  assert.equal(renamed.bindings.action.name, 'commandButton');
  assert.equal(renamed.document.nodes.find(node => node.id === 'action').properties.Name, 'Action');
  assert.equal(planDesignSourceUpdate(renamed, renamed.document).text, renamed.text);
});
