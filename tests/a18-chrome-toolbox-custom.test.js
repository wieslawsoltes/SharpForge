import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, DesignerOptionsService, DesignerToolboxCatalog, createDesign,
  insertToolboxControl, normalizeToolboxTabs, projectControlCandidates, discoverPreviewProjectControls,
  discoverProjectControls, designPreviewCapability, readDesignSource, validateProjectControl
} from '@sharpforge/designer';
import {DesignerToolbox} from '../apps/studio/designer-toolbox.js';
import {DesignerOutlineState, moveOutlineNodes} from '../apps/studio/designer-outline-state.js';
import {CONTROLS} from '@sharpforge/framework';

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

function previewDescriptor() {
  const analysis = readDesignSource(source, {uri: 'Widget.cs', className: 'Example.Widget', methodName: 'InitializeComponent'});
  const capability = designPreviewCapability(analysis);
  assert.equal(analysis.compilationSucceeded, false);
  assert.equal(capability.previewAvailable, true);
  return capability.descriptor;
}

function toolboxFixture() {
  const stored = new Map();
  const settings = {getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value)};
  const options = new DesignerOptionsService(settings);
  const view = {document: new DesignDocument(createDesign()), designerOptions: options, search: '', naming: 'type',
    safe: action => action(), accessibility: {announce() {}}};
  const toolbox = new DesignerToolbox(view);
  toolbox.render = () => {};
  return {toolbox, view, options, settings, stored};
}

test('direct project-control candidates make no compile claim and retain namespace and alias identities', () => {
  const candidates = projectControlCandidates([{uri: 'Controls.cs', text: `
    using Microsoft.UI.Xaml.Controls;
    using UC = Microsoft.UI.Xaml.Controls.UserControl;
    namespace Example {
      class Direct : UserControl {} class Alias : UC {} class Derived : Direct {}
      abstract class Abstract : UserControl {} class Generic<T> : UserControl {} class Ordinary {}
    }`}]);
  assert.deepEqual(candidates, [{type: 'Example.Alias', uri: 'Controls.cs'}, {type: 'Example.Direct', uri: 'Controls.cs'}]);
  assert.ok(candidates.every(candidate => candidate.success === undefined && candidate.previewOnly === undefined));
  assert.throws(() => projectControlCandidates(Array.from({length: 257}, () => ({text: ''}))), /256/);
});

test('failed inheritance analysis enters a separate proven preview catalog without promoting compiler success', () => {
  const descriptor = previewDescriptor();
  const snapshot = {success: false, previewAvailable: true, projectTypes: [descriptor], version: 3};
  const catalog = new DesignerToolboxCatalog();
  catalog.updateAnalysis({success: true, version: 2, projectTypes: [{type: 'Previous.Compiled', baseType: CONTROLS + 'UserControl'}]});
  assert.equal(catalog.updateAnalysis(snapshot), false);
  assert.equal(catalog.updatePreviewAnalysis(snapshot), true);
  const preview = catalog.control('Example.Widget');
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.readOnly, true);
  assert.equal(preview.compilationSucceeded, false);
  assert.deepEqual(preview.rootAssignment, descriptor.rootAssignment);
  assert.equal(catalog.control('Previous.Compiled').previewOnly, undefined);
  assert.equal(snapshot.success, false);
  assert.equal(catalog.updatePreviewAnalysis({...snapshot, version: 2}), false);
  assert.deepEqual(discoverPreviewProjectControls({...snapshot, success: true}), []);
  assert.throws(() => discoverProjectControls({...snapshot, success: true}), /preview-only/);
  assert.equal(catalog.updateAnalysis({success: true, version: 4, projectTypes: []}), true);
  assert.deepEqual(catalog.items('project'), []);
});

test('preview metadata cannot lose its read-only/error markers or spoof an unrelated ownership proof', () => {
  const descriptor = previewDescriptor();
  for (const invalid of [
    {...descriptor, readOnly: false}, {...descriptor, compilationSucceeded: true}, {...descriptor, previewOnly: false},
    {...descriptor, rootAssignment: {...descriptor.rootAssignment, owner: 'Other.Widget'}},
    {...descriptor, rootAssignment: {...descriptor.rootAssignment, capabilities: ['preview', 'execute']}}
  ]) {
    assert.throws(() => validateProjectControl(invalid), /read-only|preview-only/i);
  }
  assert.throws(() => discoverPreviewProjectControls({success: false, previewAvailable: true, version: 1,
    projectTypes: [descriptor, descriptor]}), /unique/);
});

test('project previews retain qualified identity and visible catalog markers when inserted into a staged document', () => {
  const {toolbox, view} = toolboxFixture();
  toolbox.updatePreviewAnalysis({success: false, previewAvailable: true, projectTypes: [previewDescriptor()], version: 1});
  const id = toolbox.insert('Example.Widget');
  assert.equal(view.document.node(id).projectType, 'Example.Widget');
  assert.equal(view.document.node(id).type, CONTROLS + 'UserControl');
  assert.equal(view.document.node(id).properties.Name, 'Widget1');
  const descriptor = view.document.value.projectTypes[0];
  assert.equal(descriptor.previewOnly, true);
  assert.equal(descriptor.readOnly, true);
  assert.equal(descriptor.compilationSucceeded, false);
  assert.equal(toolbox.catalog.items('recent')[0].previewOnly, true);
});

test('custom tab commands persist selected controls and restore them in a new designer', () => {
  const {toolbox, view, options, settings} = toolboxFixture();
  const before = view.document.serialize();
  const id = toolbox.tabsController.create('My inputs', ['Button', 'TextBox', 'Button']);
  assert.equal(toolbox.tab, id);
  assert.deepEqual(toolbox.catalog.items(id).map(control => control.name), ['Button', 'TextBox']);
  assert.equal(view.document.serialize(), before);
  const restoredOptions = new DesignerOptionsService(settings);
  restoredOptions.load();
  const restored = new DesignerToolbox({...view, designerOptions: restoredOptions});
  restored.tabsController.load();
  assert.deepEqual(restored.catalog.snapshotTabs(), toolbox.catalog.snapshotTabs());
  toolbox.tabsController.remove(id);
  assert.equal(toolbox.tab, 'common');
  assert.deepEqual(options.value.toolboxTabs.tabs, []);
  assert.throws(() => toolbox.tabsController.remove('common'), /custom toolbox tab/);
});

test('failed settings persistence leaves the active toolbox tabs unchanged', () => {
  const {toolbox, settings} = toolboxFixture();
  const before = toolbox.catalog.snapshotTabs();
  settings.setItem = () => { throw new Error('Settings write failed'); };
  assert.throws(() => toolbox.tabsController.create('My tab', ['Button']), /Settings write failed/);
  assert.deepEqual(toolbox.catalog.snapshotTabs(), before);
  assert.equal(toolbox.tab, 'common');
});

test('saved tabs are bounded, reject reserved IDs, and keep unavailable project identities until analysis arrives', () => {
  const catalog = new DesignerToolboxCatalog();
  const snapshot = normalizeToolboxTabs({version: 1, tabs: [{id: 'widgets', label: 'Widgets', types: ['Button', 'Example.Widget']}]});
  catalog.restoreTabs(snapshot);
  assert.deepEqual(catalog.items('widgets').map(control => control.name), ['Button']);
  catalog.updatePreviewAnalysis({success: false, previewAvailable: true, projectTypes: [previewDescriptor()], version: 1});
  assert.deepEqual(catalog.items('widgets').map(control => control.name), ['Button', 'Widget']);
  assert.throws(() => normalizeToolboxTabs({version: 1, tabs: [{id: 'common', label: 'Reserved', types: []}]}), /unique/);
  assert.throws(() => normalizeToolboxTabs({version: 1, tabs: new Array(17)}), /limit/);
  assert.throws(() => normalizeToolboxTabs({version: 1, tabs: [{id: 'bad', label: 'Bad', types: ['A;Run()']}]}), /Invalid/);
  const original = catalog.snapshotTabs();
  assert.throws(() => catalog.restoreTabs({version: 1, tabs: [{id: 'bad', label: '', types: []}]}), /limit/);
  assert.deepEqual(catalog.snapshotTabs(), original);
});

for (const [naming, expected] of [['type', 'Button1'], ['camelCase', 'button1'], ['none', '']]) {
  test('toolbox click and drawn insertion honor the ' + naming + ' naming preference', () => {
    const {toolbox, view} = toolboxFixture();
    view.naming = naming;
    const id = toolbox.insert('Button');
    assert.equal(view.document.node(id).properties.Name, expected);
    view.document.select('canvas');
    const drawn = toolbox.createDrawn('TextBox', {parentId: 'canvas', bounds: {x: 20, y: 30, width: 140, height: 40}});
    assert.equal(view.document.node(drawn).properties.Name, naming === 'none' ? '' : naming === 'type' ? 'TextBox1' : 'textBox1');
    assert.equal(view.document.node(drawn).properties.Left, 20);
    assert.equal(view.document.undoStack.length, 2);
  });
}

test('generated names avoid node and Items names while preserving explicit caller names', () => {
  const document = new DesignDocument(createDesign());
  const catalog = new DesignerToolboxCatalog();
  document.setProperty('Name', 'Button1', ['action']);
  const choices = document.add('ComboBox', 'canvas');
  document.change('Named item', draft => {
    draft.nodes.find(node => node.id === choices).collections = {Items: [{type: 'ComboBoxItem', properties: {Name: 'Button2', Content: 'Item'}}]};
  });
  const id = insertToolboxControl(document, catalog, 'Button', {parentId: 'canvas'});
  assert.equal(document.node(id).properties.Name, 'Button3');
  const explicit = insertToolboxControl(document, catalog, 'Button', {parentId: 'canvas', naming: 'none', properties: {Name: 'ChosenName'}});
  assert.equal(document.node(explicit).properties.Name, 'ChosenName');
});

test('read-only source previews reject insertion and outline edits while retaining local visibility and selection', () => {
  const {toolbox, view} = toolboxFixture();
  const document = view.document;
  Object.defineProperty(document, 'readOnly', {value: true});
  const state = new DesignerOutlineState(document);
  const before = document.serialize();
  assert.throws(() => toolbox.insert('Button'), /read only/);
  assert.throws(() => toolbox.createDrawn('Button', {bounds: {x: 0, y: 0, width: 30, height: 20}}), /read only/);
  assert.throws(() => moveOutlineNodes(document, state, ['action'], 'title', 'before'), /read only/);
  state.toggle('action', 'hidden');
  document.select('title');
  assert.equal(state.isVisible('action'), false);
  assert.equal(document.node().id, 'title');
  assert.equal(document.serialize(), before);
});
