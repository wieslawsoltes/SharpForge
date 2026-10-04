import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeDesignSources, designPreviewCapability, designComposedPreviewCapability,
  DesignerRootRegistry, designScene, planDesignSourceUpdate
} from '@sharpforge/designer';
import {
  componentFiles, componentSource, componentType, componentUri, compositionSource, designerWorkerHarness
} from './fixtures/a18-component-preview.js';

const componentOptions = {uri: componentUri, className: componentType, methodName: 'InitializeComponent'};
const inheritanceMessage = 'The program is valid C# but is not executable on this runtime profile: it uses class inheritance';

function assertReadOnlyComposition(result) {
  assert.equal(result.success, false);
  assert.equal(result.previewAvailable, true, JSON.stringify(result.diagnostics));
  assert.equal(result.readOnly, true);
  assert.equal(result.analysis.canApply, false);
  assert.equal(result.analysis.compilationSucceeded, false);
  assert.equal(result.analysis.previewCapability.kind, 'composition');
  assert.equal(result.analysis.previewCapability.sourceWrites, false);
  const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  assert.ok(errors.some(diagnostic => diagnostic.code === 'SF1014'));
  assert.ok(errors.some(diagnostic => diagnostic.code === 'SF2200' && diagnostic.message === inheritanceMessage));
  assert.ok(errors.every(diagnostic => ['SF1014', 'SF2200'].includes(diagnostic.code)), JSON.stringify(errors));
}

test('qualified and aliased source constructions retain the bound component identity without authorizing writes', async context => {
  const compiler = designerWorkerHarness(context);
  for (const spelling of ['Widget', 'Example.Widget', 'ChosenWidget']) {
    const source = (spelling === 'ChosenWidget' ? 'using ChosenWidget = Example.Widget;\n' : '')
      + compositionSource.replace('new Widget()', `new ${spelling}()`);
    const files = componentFiles().concat({uri: 'Host.cs', text: source, version: 1});
    const result = await compiler.request('designAnalyze', {files, uri: 'Host.cs', className: 'Example.Host', revision: 3});
    assertReadOnlyComposition(result);
    assert.equal(result.analysis.document.nodes.find(node => node.id === 'widget').projectType, componentType);
    const component = analyzeDesignSources(files, componentOptions);
    const host = analyzeDesignSources(files, {uri: 'Host.cs', className: 'Example.Host', projectTypes: result.projectTypes});
    assert.equal(host.structuralEditable, true);
    assert.deepEqual(host.unmanaged, []);
    assert.deepEqual(host.warnings, []);
    assert.equal(host.bindings.widget.sourceType, spelling);
    assert.equal(host.sources.find(file => file.uri === 'Host.cs').text, source);
    const registry = new DesignerRootRegistry();
    registry.registerPreview(result.projectTypes[0], component, {analysisVersion: 3});
    const projected = registry.project(host.document, designScene(host.document));
    assert.deepEqual(projected.diagnostics, []);
    assert.ok(projected.scene.nodes.some(node => node.componentDocument === componentUri && node.properties.Content === 'Owned'));
    assert.throws(() => planDesignSourceUpdate(host, host.document, files, {requireCompilation: true}), {code: 'SFSYNC_COMPILE'});
  }
});

test('components with equal short names project only their independently qualified source definitions', async context => {
  const compiler = designerWorkerHarness(context);
  const files = ['Left', 'Right'].map(namespace => ({uri: namespace + '.cs', version: 1,
    text: componentSource.replace('namespace Example', 'namespace ' + namespace).replace('"Owned"', `"${namespace}"`)}));
  files.push({uri: 'Host.cs', version: 1, text: `using Microsoft.UI.Xaml.Controls;
using Selected = Right.Widget;
class Host {
  public static Page Create() {
    var page = new Page();
    var panel = new StackPanel();
    var left = new Left.Widget();
    var right = new Selected();
    panel.Children.Add(left);
    panel.Children.Add(right);
    page.Content = panel;
    return page;
  }
}`});
  const result = await compiler.request('designAnalyze', {files, uri: 'Host.cs', className: 'Host', revision: 5});
  assertReadOnlyComposition(result);
  const registry = new DesignerRootRegistry();
  for (const namespace of ['Left', 'Right']) {
    const type = namespace + '.Widget';
    const descriptor = result.projectTypes.find(candidate => candidate.type === type);
    const component = analyzeDesignSources(files, {uri: namespace + '.cs', className: type, methodName: 'InitializeComponent'});
    registry.registerPreview(descriptor, component, {analysisVersion: 5});
    assert.equal(result.analysis.document.nodes.find(node => node.id === namespace.toLowerCase()).projectType, type);
  }
  const projected = registry.project(result.analysis.document, designScene(result.analysis.document));
  assert.deepEqual(projected.diagnostics, []);
  for (const namespace of ['Left', 'Right']) {
    assert.ok(projected.scene.nodes.some(node => node.componentDocument === namespace + '.cs'
      && node.properties.Content === namespace && node.designId === namespace.toLowerCase()));
  }
});

test('a bound source class that shadows a framework control cannot borrow the framework preview identity', async context => {
  const compiler = designerWorkerHarness(context);
  const text = `using Microsoft.UI.Xaml.Controls;
namespace HostSpace {
  class Button { }
  class Host {
    public static Page Create() {
      var page = new Page();
      var button = new Button();
      page.Content = button;
      return page;
    }
  }
}`;
  const files = componentFiles().concat({uri: 'Host.cs', text, version: 1});
  const result = await compiler.request('designAnalyze', {files, uri: 'Host.cs', className: 'HostSpace.Host'});
  assert.equal(result.success, false);
  assert.equal(result.previewAvailable, false);
  assert.equal(result.analysis.structuralEditable, false);
  assert.deepEqual(result.analysis.document.nodes.map(node => node.id), ['page']);
  const protectedReference = result.diagnostics.find(diagnostic => diagnostic.legacyCode === 'SFSYNC_DYNAMIC');
  assert.ok(protectedReference, JSON.stringify(result.diagnostics));
  assert.equal(protectedReference.code, 'SFD0003');
  assert.equal(protectedReference.severity, 'warning');
  assert.equal(protectedReference.source, 'Designer');
  assert.equal(protectedReference.uri, 'Host.cs');
  assert.equal(text.slice(protectedReference.start, protectedReference.start + protectedReference.length), 'button');
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'SF2200' && diagnostic.message === inheritanceMessage));
});

test('a sibling partial constructor retains ownership while sibling initializers block closed composition', () => {
  const constructor = 'public Widget() { InitializeComponent(); }';
  const files = componentFiles({composition: true}).map(file => ({...file, text: file.text.replace(constructor, '')}));
  files.push({uri: 'Widget.Constructor.cs', version: 1,
    text: `namespace Example { public partial class Widget { ${constructor} } }`});
  const component = analyzeDesignSources(files, componentOptions);
  const descriptor = designPreviewCapability(component).descriptor;
  const hostOptions = {uri: 'Host.cs', className: 'Example.Host', projectTypes: [descriptor]};
  const host = analyzeDesignSources(files, hostOptions);
  assert.equal(designComposedPreviewCapability(host, [component]).previewAvailable, true);
  const withInitializer = files.concat({uri: 'Widget.State.cs', version: 1,
    text: 'namespace Example { public partial class Widget { int initialized = 1; } }'});
  const unsafeComponent = analyzeDesignSources(withInitializer, componentOptions);
  const unsafeHost = analyzeDesignSources(withInitializer, hostOptions);
  const rejected = designComposedPreviewCapability(unsafeHost, [unsafeComponent]);
  assert.equal(rejected.previewAvailable, false);
  assert.equal(rejected.sourceWrites, false);
  assert.match(rejected.reason, /constructor/);
});

test('matching simple names in a different namespace do not import another component constructor side effects', () => {
  const files = componentFiles({composition: true}).concat({uri: 'Unrelated.cs', version: 1,
    text: 'namespace Unrelated { class Widget { int initialized = 1; public Widget() {} } }'});
  const component = analyzeDesignSources(files, componentOptions);
  const descriptor = designPreviewCapability(component).descriptor;
  const host = analyzeDesignSources(files, {uri: 'Host.cs', className: 'Example.Host', projectTypes: [descriptor]});
  const capability = designComposedPreviewCapability(host, [component]);
  assert.equal(capability.previewAvailable, true, capability.reason);
  assert.equal(capability.readOnly, true);
  assert.equal(capability.sourceWrites, false);
});
