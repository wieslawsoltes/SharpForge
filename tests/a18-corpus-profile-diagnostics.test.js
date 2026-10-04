import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {DesignDocument, designSourceSnapshot, planDesignSourceUpdate} from '@sharpforge/designer';
import {corpusFixtures, loadFixture, analyzeFixture, loadGolden} from './fixtures/a18/corpus.js';

const profileMessage = 'The program is valid C# but is not executable on this runtime profile: it uses ';
const errorsOf = result => result.diagnostics.filter(diagnostic => diagnostic.severity === 'error');

function fixtureNamed(id) {
  const fixture = corpusFixtures.find(candidate => candidate.id === id);
  assert.ok(fixture, id);
  return fixture;
}

function assertSourceSpan(diagnostic, sources) {
  const source = sources.find(candidate => candidate.uri === diagnostic.uri);
  assert.ok(source, 'The compiler diagnostic names an input source.');
  assert.ok(Number.isInteger(diagnostic.start) && diagnostic.start >= 0);
  assert.ok(Number.isInteger(diagnostic.length) && diagnostic.length > 0);
  assert.ok(diagnostic.start + diagnostic.length <= source.text.length);
  assert.ok(source.text.slice(diagnostic.start, diagnostic.start + diagnostic.length).trim().length > 0);
}

// This compilation guard owns its edits; the inline corpus fixture has no optional minimal-diff edit.
for (const [id, nodeId] of [['38-event-lambda', 'action'], ['48-inline-collection', 'root_Children_0']]) {
  test('reviewed corpus runtime-profile diagnostic retains failed compilation and source guards: ' + id, () => {
    const fixture = fixtureNamed(id);
    const sources = loadFixture(fixture);
    const originals = structuredClone(sources);
    const compiled = compileToIL(sources, {outputKind: 'library'});
    assert.equal(compiled.success, false);
    assert.equal(compiled.image, null);
    assert.equal(compiled.assembly, null);
    assert.equal(compiled.semantic?.complete, true, JSON.stringify(compiled.diagnostics));
    const errors = errorsOf(compiled);
    assert.deepEqual(errors.map(diagnostic => diagnostic.code), ['SF2200']);
    assert.ok(errors[0].message.startsWith(profileMessage));
    assert.ok(errors[0].message.length > profileMessage.length);
    assertSourceSpan(errors[0], sources);

    const analysis = analyzeFixture(fixture, sources);
    const baseline = designSourceSnapshot(analysis);
    const golden = loadGolden(fixture);
    assert.equal(analysis.compilationSucceeded, false);
    assert.equal(analysis.structuralEditable, fixture.expected.structuralEditable);
    assert.deepEqual(analysis.compilerDiagnostics, compiled.diagnostics);
    assert.deepEqual(baseline.diagnostics.filter(diagnostic => diagnostic.source === 'C#'),
      compiled.diagnostics.map(diagnostic => ({...diagnostic, source: 'C#'})));
    assert.deepEqual(golden.diagnostics.filter(diagnostic => diagnostic.severity === 'error'),
      [{code: 'SF2200', legacyCode: null, severity: 'error'}]);
    assert.equal(fixture.execute, false);

    const document = new DesignDocument(analysis.document);
    assert.equal(document.node(nodeId).properties.Width, 160);
    document.setProperty('Width', 211, [nodeId]);
    assert.throws(() => planDesignSourceUpdate(analysis, document.value, sources, {requireCompilation: true}), error => {
      assert.equal(error.code, 'SFSYNC_COMPILE');
      assert.equal(error.diagnosticId, 'SFD0012');
      assert.deepEqual(error.details.diagnostics.map(diagnostic => diagnostic.code), ['SF2200']);
      assertSourceSpan(error.details.diagnostics[0], sources);
      return true;
    });
    assert.deepEqual(designSourceSnapshot(analysis), baseline);
    assert.deepEqual(sources, originals);

    if (id === '38-event-lambda') {
      const event = baseline.bindings.action.events.Click;
      assert.equal(event.capability, 'navigate');
      assert.equal(event.subscriptions.length, 1);
      assert.equal(event.subscriptions[0].protected, true);
      assert.deepEqual(analysis.document.nodes.find(node => node.id === 'action').events, {});
      assert.ok(baseline.diagnostics.some(diagnostic => diagnostic.code === 'SFD0010'
        && diagnostic.legacyCode === 'SFSYNC_EVENT' && diagnostic.severity === 'warning'));
    } else {
      assert.deepEqual(analysis.document.nodes.find(node => node.id === 'root').children,
        ['root_Children_0', 'root_Children_1']);
      assert.deepEqual(analysis.warnings, []);
    }
  });
}

test('a genuinely incompatible handler retains CS0123 and cannot become a runtime-profile-only failure', () => {
  const sources = loadFixture(fixtureNamed('38-event-lambda')).map(source => ({
    ...source,
    text: source.text.replace('action.Click += (sender, args) => { Console.WriteLine("lambda"); };',
      'action.Click += OnClick;').replace('void OnClick(object sender, RoutedEventArgs args)',
      'void OnClick(int sender, RoutedEventArgs args)'),
  }));
  const result = compileToIL(sources, {outputKind: 'library'});
  assert.equal(result.success, false);
  assert.equal(result.image, null);
  assert.equal(result.assembly, null);
  const errors = errorsOf(result);
  assert.ok(errors.some(diagnostic => diagnostic.code === 'CS0123'), JSON.stringify(errors));
  assert.ok(errors.every(diagnostic => diagnostic.code !== 'SF2200'), JSON.stringify(errors));
  assertSourceSpan(errors.find(diagnostic => diagnostic.code === 'CS0123'), sources);
});

test('assigning the read-only Children property retains CS0200 while its nested initializer stays valid C#', () => {
  const sources = loadFixture(fixtureNamed('48-inline-collection')).map(source => ({
    ...source,
    text: source.text.replace('window.Content = root;', 'root.Children = root.Children;\n        window.Content = root;'),
  }));
  const result = compileToIL(sources, {outputKind: 'library'});
  assert.equal(result.success, false);
  assert.equal(result.image, null);
  assert.equal(result.assembly, null);
  const errors = errorsOf(result);
  assert.ok(errors.some(diagnostic => diagnostic.code === 'CS0200'), JSON.stringify(errors));
  assert.ok(errors.every(diagnostic => diagnostic.code !== 'SF2200'), JSON.stringify(errors));
  assertSourceSpan(errors.find(diagnostic => diagnostic.code === 'CS0200'), sources);
});
