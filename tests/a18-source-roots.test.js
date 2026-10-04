import test from 'node:test';
import assert from 'node:assert/strict';
import {readDesignSource, analyzeDesignSources, designSourceSnapshot, DesignDocument, planDesignSourceUpdate,
  designPreviewCapability, designInheritancePreviewProfile, wrapDesignPreviewRoot, designScene} from '@sharpforge/designer';

const source = `using Microsoft.UI.Xaml.Controls;
namespace Example {
  partial class Widget : UserControl {
    void InitializeComponent() {
      var root = new Grid();
      var action = new Button() { Content = "Owned" };
      root.Children.Add(action);
      this.Content = root;
    }
  }
}`;
const options = {uri: 'Widget.cs', className: 'Example.Widget', methodName: 'InitializeComponent'};

test('instance component content has serialized source evidence without adding an editable synthetic node', () => {
  const analysis = readDesignSource(source, options);
  const evidence = designSourceSnapshot(analysis).ownership.rootAssignment;
  assert.equal(evidence.owner, 'Example.Widget');
  assert.equal(evidence.methodName, 'InitializeComponent');
  assert.equal(evidence.receiver, 'this');
  assert.equal(evidence.property, 'Content');
  assert.equal(evidence.baseType, 'Microsoft.UI.Xaml.Controls.UserControl');
  assert.equal(source.slice(evidence.baseSpan.start, evidence.baseSpan.end), 'UserControl');
  assert.equal(evidence.childId, analysis.document.root);
  assert.deepEqual(evidence.capabilities, ['preview', 'navigate']);
  assert.equal(source.slice(evidence.span.start, evidence.span.end), 'this.Content = root;');
  assert.deepEqual(analysis.document.nodes.map(node => node.id), ['root', 'action']);
  assert.equal(analysis.compilationSucceeded, false);
  assert.ok(analysis.compilerDiagnostics.some(diagnostic => diagnostic.code === 'SF2200' && diagnostic.severity === 'error'));
  assert.throws(() => planDesignSourceUpdate(analysis, analysis.document, source, {requireCompilation: true}),
    error => error.code === 'SFSYNC_COMPILE');
});

test('component root evidence follows retained identities after source symbol rename', () => {
  const previous = readDesignSource(source, options);
  const text = source.replaceAll('root', 'surface');
  const analysis = readDesignSource(text, {...options, previous});
  assert.equal(analysis.identityRemap.surface, 'root');
  assert.equal(analysis.ownership.rootAssignment.childId, 'root');
  assert.equal(analysis.bindings.root.name, 'surface');
});

test('inline instance content exposes literal edits on the actual construction expression', () => {
  const text = source.replace('var root = new Grid();\n      var action = new Button() { Content = "Owned" };\n' +
    '      root.Children.Add(action);\n      this.Content = root;', 'this.Content = new Grid() { Width = 160 };');
  const analysis = readDesignSource(text, options);
  const document = new DesignDocument(analysis.document);
  document.setProperty('Width', 200, [document.value.root]);
  const plan = planDesignSourceUpdate(analysis, document.value);
  assert.equal(plan.text, text.replace('Width = 160', 'Width = 200'));
  assert.equal(plan.analysis.ownership.rootAssignment.childId, document.value.root);
});

test('computed instance content does not claim direct root ownership', () => {
  const text = source.replace('this.Content = root;', 'this.Content = MakeContent();')
    .replace('void InitializeComponent()', 'Grid MakeContent() { return new Grid(); }\n    void InitializeComponent()');
  const analysis = readDesignSource(text, options);
  assert.equal(analysis.ownership.rootAssignment, undefined);
  assert.equal(analysis.structuralEditable, false);
  assert.equal(designPreviewCapability(analysis).previewAvailable, false);
});

test('inheritance-only profile errors allow an explicit read-only component preview without changing diagnostics', () => {
  const analysis = readDesignSource(source, options);
  const diagnostics = structuredClone(analysis.compilerDiagnostics);
  const capability = designPreviewCapability(analysis);
  assert.equal(capability.previewAvailable, true);
  assert.equal(capability.readOnly, true);
  assert.equal(capability.sourceWrites, false);
  assert.equal(capability.descriptor.type, 'Example.Widget');
  assert.equal(capability.descriptor.previewOnly, true);
  assert.equal(capability.descriptor.compilationSucceeded, false);
  assert.deepEqual(designPreviewCapability(designSourceSnapshot(analysis)), capability);
  assert.equal(analysis.compilationSucceeded, false);
  assert.deepEqual(analysis.compilerDiagnostics, diagnostics);
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'SF1014' && diagnostic.severity === 'error'));
  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'SF2200' && diagnostic.severity === 'error'));
});

test('preview wrapping keeps the authoring document separate and rejects synthetic source writes', () => {
  const analysis = readDesignSource(source, options);
  const before = structuredClone(analysis.document);
  const preview = wrapDesignPreviewRoot(analysis);
  assert.deepEqual(analysis.document, before);
  assert.equal(preview.sourceRootId, 'root');
  assert.equal(preview.readOnly, true);
  assert.equal(preview.document.previewOnly, true);
  assert.equal(preview.document.nodes[0].type, 'Microsoft.UI.Xaml.Controls.UserControl');
  assert.deepEqual(preview.document.nodes[0].children, ['root']);
  const scene = designScene(preview.document);
  assert.deepEqual(scene.nodes.find(node => node.id === preview.previewRootId).properties.Content, {$ref: 'root'});
  assert.equal(scene.nodes.find(node => node.id === 'action').properties.Content, 'Owned');
  assert.throws(() => planDesignSourceUpdate(analysis, preview.document), error => error.code === 'SFSYNC_OWNERSHIP');
  assert.throws(() => wrapDesignPreviewRoot(analysis, {type: 'Example.Widget', baseType: 'Page'}),
    error => error.code === 'SFSYNC_OWNERSHIP');
});

test('the inheritance exception rejects unrelated C# errors, other profile gaps and protected expressions', () => {
  const analysis = readDesignSource(source, options);
  const extra = {code: 'CS0103', severity: 'error', message: 'The name does not exist'};
  assert.equal(designInheritancePreviewProfile([...analysis.compilerDiagnostics, extra]), false);
  assert.equal(designPreviewCapability({...analysis, compilerDiagnostics: [...analysis.compilerDiagnostics, extra]}).previewAvailable, false);
  assert.equal(designInheritancePreviewProfile(analysis.compilerDiagnostics.filter(diagnostic => diagnostic.code !== 'SF1014')), false);
  assert.equal(designInheritancePreviewProfile(analysis.compilerDiagnostics.map(diagnostic => diagnostic.code === 'SF2200'
    ? {...diagnostic, message: diagnostic.message + ', dynamic'} : diagnostic)), false);
  const unknown = readDesignSource(source.replace('Content = "Owned"', 'Content = missing'), options);
  assert.equal(designPreviewCapability(unknown).previewAvailable, false);
  const dynamic = readDesignSource(source.replace('Content = "Owned"', 'Content = GetCaption()')
    .replace('void InitializeComponent()', 'string GetCaption() { return "Caption"; }\n    void InitializeComponent()'), options);
  assert.equal(designPreviewCapability(dynamic).previewAvailable, false);
});

test('direct base evidence follows an aliased sibling partial declaration', () => {
  const files = [
    {uri: 'Widget.cs', text: source.replace(' : UserControl', '')},
    {uri: 'Widget.Type.cs', text: 'using View = Microsoft.UI.Xaml.Controls.UserControl; namespace Example { partial class Widget : View {} }'}
  ];
  const analysis = analyzeDesignSources(files, options);
  const capability = designPreviewCapability(analysis);
  assert.equal(capability.previewAvailable, true);
  assert.equal(capability.descriptor.rootAssignment.baseUri, 'Widget.Type.cs');
  assert.equal(capability.descriptor.baseType, 'Microsoft.UI.Xaml.Controls.UserControl');
});

test('direct Page preview uses the declared base, while an indirect project base remains unsupported', () => {
  const page = readDesignSource(source.replace('Widget : UserControl', 'Widget : Page'), options);
  assert.equal(designPreviewCapability(page).descriptor.baseType, 'Microsoft.UI.Xaml.Controls.Page');
  const text = source.replace('Widget : UserControl', 'Widget : ComponentBase')
    .replace('partial class Widget', 'class ComponentBase : UserControl {}\n  partial class Widget');
  const indirect = readDesignSource(text, options);
  assert.equal(designPreviewCapability(indirect).previewAvailable, false);
  assert.equal(indirect.ownership.rootAssignment.baseType, undefined);
});
