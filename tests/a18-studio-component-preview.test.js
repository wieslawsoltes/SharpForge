import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeDesignSources, designPreviewCapability, designComposedPreviewCapability,
  DesignerRootRegistry, designScene, planDesignSourceUpdate
} from '@sharpforge/designer';
import {DesignerProjectRoots} from '../apps/studio/designer-project-roots.js';
import {componentFiles, componentSource, componentUri, componentType, designerWorkerHarness} from './fixtures/a18-component-preview.js';

const named = {uri: componentUri, className: componentType, methodName: 'InitializeComponent'};

test('worker returns a source-proven component preview with compiler errors and an explicit non-executable catalog', async context => {
  const compiler = designerWorkerHarness(context);
  const result = await compiler.request('designAnalyze', {...named, files: componentFiles(), revision: 7});
  assert.equal(result.success, false);
  assert.equal(result.previewAvailable, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.analysis.canApply, false);
  assert.equal(result.analysis.compilationSucceeded, false);
  for (const code of ['SF1014', 'SF2200']) {
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === code && diagnostic.severity === 'error'));
  }
  assert.equal(result.projectTypes[0].previewOnly, true);
  assert.equal(result.projectTypes[0].analysisVersion, 7);
  assert.equal(result.analysis.document.nodes[0].type, 'Microsoft.UI.Xaml.Controls.Grid');
  const registry = new DesignerRootRegistry();
  assert.throws(() => registry.register(result.projectTypes[0], result.analysis.document, {analysisVersion: 7}), {code: 'SFD1861'});
  registry.registerPreview(result.projectTypes[0], result.analysis, {analysisVersion: 7});
  const preview = registry.definition({projectType: componentType}).document;
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.nodes.find(node => node.id === preview.root).type, 'Microsoft.UI.Xaml.Controls.UserControl');
  assert.equal(preview.nodes.find(node => node.id === 'action').properties.Content, 'Owned');
  assert.throws(() => registry.registerPreview({...result.projectTypes[0], uri: 'Other.cs'}, result.analysis,
    {analysisVersion: 7}), /does not match/);
  assert.throws(() => registry.registerPreview(result.projectTypes[0], result.analysis, {analysisVersion: 8}), {code: 'SFD1861'});
});

test('a closed Page factory composes a proven Widget constructor without authorizing compilation or edits', async context => {
  const compiler = designerWorkerHarness(context);
  const files = componentFiles({composition: true});
  const result = await compiler.request('designAnalyze', {files, uri: 'Host.cs', className: 'Example.Host', revision: 4});
  assert.equal(result.success, false, JSON.stringify(result.diagnostics));
  assert.equal(result.previewAvailable, true, result.analysis?.previewCapability?.reason);
  assert.equal(result.analysis.previewCapability.kind, 'composition');
  assert.equal(result.analysis.readOnly, true);
  assert.equal(result.analysis.document.nodes.find(node => node.id === 'widget').projectType, componentType);
  const component = analyzeDesignSources(files, named);
  const registry = new DesignerRootRegistry();
  registry.registerPreview(result.projectTypes[0], component, {analysisVersion: 4});
  const projected = registry.project(result.analysis.document, designScene(result.analysis.document));
  assert.deepEqual(projected.diagnostics, []);
  assert.ok(projected.scene.nodes.some(node => node.properties.Content === 'Owned' && node.componentDocument === componentUri));
  assert.equal(result.analysis.document.previewOnly, undefined);
  const raw = analyzeDesignSources(files, {uri: 'Host.cs', className: 'Example.Host', projectTypes: result.projectTypes});
  assert.throws(() => planDesignSourceUpdate(raw, raw.document, files, {requireCompilation: true}), {code: 'SFSYNC_COMPILE'});
});

test('composition requires the matching revision, constructor invocation, and unmodified component content', () => {
  const files = componentFiles({composition: true});
  const component = analyzeDesignSources(files, named);
  const descriptor = designPreviewCapability(component).descriptor;
  const host = analyzeDesignSources(files, {uri: 'Host.cs', className: 'Example.Host', projectTypes: [descriptor]});
  assert.equal(designComposedPreviewCapability(host, [component]).previewAvailable, true);
  const newerFiles = files.map(file => ({...file, version: 2}));
  const newer = analyzeDesignSources(newerFiles, named);
  assert.equal(designComposedPreviewCapability(host, [newer]).previewAvailable, false);
  const withoutCall = files.map(file => ({...file, text: file.text.replace('public Widget() { InitializeComponent(); }', '')}));
  const uncalled = analyzeDesignSources(withoutCall, named);
  const uncalledHost = analyzeDesignSources(withoutCall, {uri: 'Host.cs', className: 'Example.Host', projectTypes: [descriptor]});
  const rejected = designComposedPreviewCapability(uncalledHost, [uncalled]);
  assert.equal(rejected.previewAvailable, false);
  assert.match(rejected.reason, /constructor/);
  const overridden = files.map(file => ({...file, text: file.text.replace('page.Content = widget;',
    'widget.Content = "Override"; page.Content = widget;')}));
  const overrideComponent = analyzeDesignSources(overridden, named);
  const overrideHost = analyzeDesignSources(overridden, {uri: 'Host.cs', className: 'Example.Host', projectTypes: [descriptor]});
  assert.equal(designComposedPreviewCapability(overrideHost, [overrideComponent]).previewAvailable, false);
});

test('lazy project roots wrap direct content and discard an obsolete workspace response', async context => {
  const compiler = designerWorkerHarness(context);
  const files = componentFiles();
  const catalog = await compiler.request('designAnalyze', {operation: 'catalog', files, revision: 2});
  let revision = 2;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const roots = new DesignerProjectRoots({revision: () => revision, workspaceId: () => 'workspace', refresh() {},
    analyze: async params => { await pending; return compiler.request('designAnalyze', {...params, signal: undefined, files, revision}); }
  });
  context.after(() => roots.dispose());
  roots.setCatalog(catalog.projectTypes, revision);
  roots.ensure(componentType);
  revision++;
  roots.reset();
  release();
  await Promise.all(roots.pending.values());
  assert.deepEqual(roots.registry.descriptors(), []);
  roots.setCatalog(catalog.projectTypes.map(descriptor => ({...descriptor, analysisVersion: revision})), revision);
  roots.ensure(componentType);
  await Promise.all(roots.pending.values());
  assert.equal(roots.registry.definition({projectType: componentType}).document.previewOnly, true);
});

test('unrelated compiler errors retain a failed catalog and supplied class metadata cannot fabricate a visual type', async context => {
  const compiler = designerWorkerHarness(context);
  const files = [{uri: componentUri, version: 1, text: componentSource.replace('Content = "Owned"', 'Content = missing')}];
  const failed = await compiler.request('designAnalyze', {...named, files, revision: 1});
  assert.equal(failed.success, false);
  assert.equal(failed.previewAvailable, false);
  assert.deepEqual(failed.projectTypes, []);
  const text = `using Microsoft.UI.Xaml.Controls;
class Fake { }
class Host { static Page Create() { var page = new Page(); var fake = new Fake(); page.Content = fake; return page; } }`;
  const forged = await compiler.request('designAnalyze', {uri: 'Host.cs', className: 'Host', files: [{uri: 'Host.cs', text, version: 1}],
    projectTypes: [{type: 'Fake', baseType: 'Microsoft.UI.Xaml.Controls.UserControl', uri: 'Host.cs'}]});
  assert.equal(forged.success, false);
  assert.equal(forged.diagnostics[0].code, 'SFD0004');
  assert.match(forged.diagnostics[0].message, /current compiled source catalog/);
});
