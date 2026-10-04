import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeDesignSources, designSourceSnapshot, designPreviewCapability, designComposedPreviewCapability,
  DesignerRootRegistry, designScene, planDesignSourceUpdate
} from '@sharpforge/designer';
import {component, componentRecords, sourceUri} from './browser_designer_gate_fixtures.mjs';
import {designerWorkerHarness, sourcePreviewHarness} from './fixtures/a18-component-preview.js';

const componentUri = 'Card.cs';
const named = {uri: componentUri, className: 'Card', methodName: '.ctor'};
const files = () => componentRecords().map(record => ({uri: record.path, text: record.text, version: 1}));

function assertBlockedPreview(result, kind) {
  assert.equal(result.success, false, JSON.stringify(result.diagnostics));
  assert.equal(result.previewAvailable, true, result.analysis?.previewCapability?.reason);
  assert.equal(result.readOnly, true);
  assert.equal(result.analysis.canApply, false);
  assert.equal(result.analysis.compilationSucceeded, false);
  assert.equal(result.analysis.previewCapability.kind, kind);
  assert.equal(result.analysis.previewCapability.sourceWrites, false);
  for (const code of ['SF1014', 'SF2200']) {
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === code && diagnostic.severity === 'error'));
  }
}

test('the browser Card constructor is independently qualified and projected inside its closed Dashboard factory', async context => {
  const compiler = designerWorkerHarness(context);
  const input = files();
  const host = await compiler.request('designAnalyze', {files: input, uri: sourceUri, revision: 8});
  assertBlockedPreview(host, 'composition');
  const descriptor = host.projectTypes.find(candidate => candidate.type === 'Card');
  assert.equal(descriptor.rootAssignment.methodName, '.ctor');
  assert.equal(descriptor.uri, componentUri);
  assert.equal(descriptor.analysisVersion, 8);
  const direct = await compiler.request('designAnalyze', {files: input, uri: componentUri, revision: 8});
  assertBlockedPreview(direct, 'component');
  assert.equal(direct.analysis.method.name, '.ctor');
  assert.equal(direct.analysis.ownership.construction.kind, 'constructor');
  const registry = new DesignerRootRegistry();
  registry.registerPreview(descriptor, direct.analysis, {analysisVersion: 8});
  const before = structuredClone(host.analysis.document);
  const projected = registry.project(host.analysis.document, designScene(host.analysis.document));
  assert.deepEqual(projected.diagnostics, []);
  assert.ok(projected.scene.nodes.some(node => node.properties.Text === 'Nested component content'
    && node.componentDocument === componentUri));
  assert.deepEqual(host.analysis.document, before);
  const definition = registry.definition({projectType: 'Card'});
  assert.equal(definition.document.previewOnly, true);
  assert.equal(definition.document.nodes.find(node => node.id === 'title').properties.Name, 'CardTitle');
});

test('direct constructor evidence survives the worker snapshot and still blocks every source plan', () => {
  const input = files();
  const direct = analyzeDesignSources(input, named);
  const capability = designPreviewCapability(direct);
  assert.equal(capability.previewAvailable, true, capability.reason);
  assert.deepEqual(designPreviewCapability(designSourceSnapshot(direct)), capability);
  assert.equal(input[1].text.slice(direct.ownership.construction.span.start, direct.ownership.construction.span.end)
    .startsWith('public Card()'), true);
  const host = analyzeDesignSources(input, {uri: sourceUri, projectTypes: [capability.descriptor]});
  assert.equal(designComposedPreviewCapability(host, [direct]).previewAvailable, true);
  const newer = analyzeDesignSources(input.map(file => ({...file, version: 2})), named);
  assert.equal(designComposedPreviewCapability(host, [newer]).previewAvailable, false);
  const withoutEvidence = designSourceSnapshot(direct);
  delete withoutEvidence.ownership.construction;
  assert.equal(designPreviewCapability(withoutEvidence).previewAvailable, false);
  assert.throws(() => planDesignSourceUpdate(direct, direct.document, input, {requireCompilation: true}), {code: 'SFSYNC_COMPILE'});
});

test('opening and refreshing a direct constructor keeps the model read-only and preserves its compiler diagnostics', async context => {
  const scope = sourcePreviewHarness(context, {files: files(), uri: componentUri});
  await scope.sync.connect();
  assert.equal(scope.sync.session.analysis.method.name, '.ctor');
  assert.equal(scope.document.readOnly, true);
  assert.equal(scope.document.node('title').properties.Text, 'Nested component content');
  assert.throws(() => scope.document.setProperty('Text', 'Changed', ['title']), {code: 'SFD1865'});
  await assert.rejects(scope.sync.write(), {code: 'SFSYNC_COMPILE'});
  scope.type(component.replace('Nested component content', 'Refreshed component content'));
  await scope.sync.read();
  assert.equal(scope.document.node('title').properties.Text, 'Refreshed component content');
  assert.equal(scope.document.readOnly, true);
  assert.equal(scope.sync.protocol.state, 'blocked');
  assert.equal(scope.sync.protocol.sourceDirty, false);
  for (const code of ['SF1014', 'SF2200']) {
    assert.ok(scope.sync.diagnostics.some(diagnostic => diagnostic.code === code && diagnostic.severity === 'error'));
  }
});

const rejectedConstructors = [
  ['field initializer', component.replace('public Card()', 'int seed = 1;\n    public Card()')],
  ['property initializer', component.replace('public Card()', 'int Seed { get; set; } = 1;\n    public Card()')],
  ['static constructor', component.replace('public Card()', 'static Card() {}\n    public Card()')],
  ['base initializer', component.replace('public Card()', 'public Card() : base()')],
  ['constructor chain', component.replace('public Card()', 'public Card(int value) {}\n    public Card() : this(1)')],
  ['parameterized construction', component.replace('public Card()', 'public Card(int value)')],
  ['custom body statement', component.replace('this.Content = body;', 'this.Content = body; System.Console.WriteLine("side effect");')],
  ['unrelated compiler error', component.replace('FontSize = 18', 'FontSize = missing')]
];

for (const [label, text] of rejectedConstructors) {
  test(`a ${label} cannot silently become a closed constructor preview`, async context => {
    const compiler = designerWorkerHarness(context);
    const result = await compiler.request('designAnalyze', {...named, files: [{uri: componentUri, text, version: 1}]});
    assert.equal(result.success, false);
    assert.notEqual(result.previewAvailable, true);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
    assert.deepEqual(result.projectTypes ?? [], []);
  });
}

test('partial constructor ownership retains the actual body URI and the separate direct-base evidence', () => {
  const input = [
    {uri: componentUri, text: 'using Microsoft.UI.Xaml.Controls; partial class Card : UserControl {}', version: 1},
    {uri: 'Card.Layout.cs', text: component.replace('class Card : UserControl', 'partial class Card'), version: 1}
  ];
  const analysis = analyzeDesignSources(input, {uri: componentUri, className: 'Card', methodName: '.ctor'});
  const capability = designPreviewCapability(analysis);
  assert.equal(capability.previewAvailable, true, capability.reason);
  assert.equal(capability.descriptor.uri, 'Card.Layout.cs');
  assert.equal(capability.descriptor.rootAssignment.baseUri, componentUri);
  assert.equal(analysis.ownership.construction.uri, 'Card.Layout.cs');
});

test('default selection accepts inline constructor content without shadowing an existing custom construction method', () => {
  const inline = 'using Microsoft.UI.Xaml.Controls; class Card : UserControl { public Card() { this.Content = new Grid(); } }';
  const direct = analyzeDesignSources([{uri: componentUri, text: inline}]);
  assert.equal(direct.method.name, '.ctor');
  assert.equal(designPreviewCapability(direct).previewAvailable, true);
  const custom = 'using Microsoft.UI.Xaml.Controls; class View { public View() {} void Compose() { var root = new Grid(); } }';
  const legacy = analyzeDesignSources([{uri: 'View.cs', text: custom}]);
  assert.equal(legacy.method.name, 'Compose');
});
