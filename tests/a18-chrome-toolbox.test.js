import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, createDesign, DesignerToolboxCatalog, toolboxInsertionParent,
  insertToolboxControl, discoverProjectControls, validateProjectControl
} from '@sharpforge/designer';

function rooted(type) {
  return new DesignDocument({version: 1, name: 'Root insertion', width: 640, height: 480, root: 'root',
    nodes: [
      {id: 'root', type, properties: {}, children: ['panel']},
      {id: 'panel', type: 'Grid', properties: {}, children: []}
    ], styles: {}, templates: {}});
}

for (const type of ['Window', 'Page', 'UserControl']) {
  test(`full ${type} root inserts into its descendant panel with one undo entry`, () => {
    const document = rooted(type);
    const catalog = new DesignerToolboxCatalog();
    assert.equal(toolboxInsertionParent(document).id, 'panel');
    const before = document.serialize();
    const id = insertToolboxControl(document, catalog, 'Button');
    assert.equal(document.parent(id).id, 'panel');
    assert.deepEqual(document.selection, [id]);
    assert.equal(document.undoStack.length, 1);
    document.undo();
    assert.equal(document.serialize(), before);
  });
}

test('container discovery descends content wrappers breadth first and skips locked targets', () => {
  const document = rooted('Window');
  document.change('Wrap content', value => {
    value.nodes[0].children = ['wrapper'];
    value.nodes.push({id: 'wrapper', type: 'Border', properties: {}, children: ['panel']});
  });
  assert.equal(toolboxInsertionParent(document).id, 'panel');
  assert.throws(() => toolboxInsertionParent(document, {accepts: () => false}), /No unlocked/);
  assert.throws(() => toolboxInsertionParent(document, {selected: 'missing'}), /Select a control/);
});

test('failed and stale analysis preserves the last successful project catalog', () => {
  const catalog = new DesignerToolboxCatalog();
  const projectTypes = [{type: 'Widgets.Dial', baseType: 'Microsoft.UI.Xaml.Controls.UserControl', uri: 'Dial.cs'}];
  assert.equal(catalog.updateAnalysis({success: true, projectTypes, version: 3}), true);
  assert.equal(catalog.updateAnalysis({success: false, projectTypes: [], version: 4}), false);
  assert.equal(catalog.updateAnalysis({success: true, projectTypes: [], version: 2}), false);
  assert.equal(catalog.items('project')[0].type, 'Widgets.Dial');
  assert.equal(catalog.updateAnalysis({success: true, projectTypes: [], version: 4}), true);
  assert.deepEqual(catalog.items('project'), []);
});

test('project controls are discovered through namespaces, aliases and inherited UserControls', () => {
  const controls = discoverProjectControls({success: true, version: 8, files: [{uri: 'Controls.cs', text: `
    using Microsoft.UI.Xaml.Controls;
    using UC = Microsoft.UI.Xaml.Controls.UserControl;
    namespace Widgets {
      public class Dial : UserControl { }
      public class Knob : Dial { }
      public class Gauge : UC { }
      public abstract class AbstractGauge : UserControl { }
      public class GenericGauge<T> : UserControl { }
      public class Ordinary { }
    }`} ]});
  assert.deepEqual(controls.map(item => item.type), ['Widgets.Dial', 'Widgets.Gauge', 'Widgets.Knob']);
  assert(controls.every(item => item.analysisVersion === 8 && item.uri === 'Controls.cs'));
  assert.deepEqual(discoverProjectControls({success: false, files: [{text: 'not valid C#'}]}), []);
});

test('custom insertion keeps the qualified identity and does not replace constructor content', () => {
  const document = new DesignDocument(createDesign());
  const catalog = new DesignerToolboxCatalog();
  catalog.updateAnalysis({success: true, version: 1, projectTypes: [
    {type: 'Widgets.Dial', baseType: 'Microsoft.UI.Xaml.Controls.UserControl', uri: 'Dial.cs'}
  ]});
  const id = insertToolboxControl(document, catalog, 'Widgets.Dial');
  assert.equal(document.node(id).projectType, 'Widgets.Dial');
  assert.equal(document.node(id).type, 'Microsoft.UI.Xaml.Controls.UserControl');
  assert.equal(document.node(id).properties.Content, undefined);
  assert.equal(document.value.projectTypes[0].uri, 'Dial.cs');
  assert.equal(document.undoStack.length, 1);
  assert.equal(document.parent(id).id, 'canvas');
});

test('toolbox recent items are bounded and unique and custom tabs are validated', () => {
  const catalog = new DesignerToolboxCatalog({recentLimit: 2});
  catalog.used('Grid');
  catalog.used('TextBox');
  catalog.used('Button');
  catalog.used('TextBox');
  assert.deepEqual(catalog.items('recent').map(item => item.name), ['TextBox', 'Button']);
  catalog.addTab('inputs', 'My inputs', ['TextBox', 'Button']);
  assert.equal(catalog.items('inputs', 'BUTTON')[0].name, 'Button');
  assert.throws(() => catalog.addTab('inputs', 'Again', []), /unique/);
  assert.throws(() => catalog.addTab('evil', '', []), /limit/);
  assert.throws(() => catalog.control('MissingControl'), /not available/);
  assert.throws(() => new DesignerToolboxCatalog({recentLimit: 0}), /limit/);
});

test('untrusted project type descriptors and oversize source snapshots are rejected', () => {
  for (const type of ['Widget; Evil()', 'A..B', '', 'A<' + 'B>']) {
    assert.throws(() => validateProjectControl({type, baseType: 'Microsoft.UI.Xaml.Controls.UserControl'}), /identifier/);
  }
  assert.throws(() => validateProjectControl({type: 'Widget', baseType: 'System.Object'}), /preview base/);
  assert.throws(() => discoverProjectControls({success: true, files: Array.from({length: 257}, () => ({text: ''}))}), /256/);
});
