import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, readDesignSource, designSourceSnapshot, planDesignSourceUpdate, copyDesignSelection,
  setDesignerSampleData, normalizeDesignerBrush, retainDesignMetadata
} from '@sharpforge/designer';
import {MEDIA} from '@sharpforge/framework';

const source = `using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
class View {
  static Window Create() {
    var window = new Window();
    var root = new Canvas();
    var action = new Button() { Name = "Action", Content = "Runtime", Width = 160 };
    var other = new TextBlock() { Text = "Other" };
    root.Children.Add(action);
    root.Children.Add(other);
    window.Content = root;
    return window;
  }
}`;

function enriched() {
  const analysis = readDesignSource(source);
  const document = new DesignDocument(analysis.document);
  setDesignerSampleData(document, 'action', {properties: {Content: 'Sample only'}});
  setDesignerSampleData(document, 'other', {properties: {Text: 'Other sample'}});
  document.change('Editor preferences', candidate => {
    candidate.designer = {guides: {version: 1, gridSize: 12, gridVisible: true, snapGrid: true,
      snapGuides: true, snapSiblings: true, tolerance: 6, guides: [{id: 'alignment', axis: 'x', position: 40}]}};
    candidate.designerOptions = {zoom: 1.5};
    candidate.editorState = {tab: 'properties'};
    candidate.nodes.find(node => node.id === 'action').runtimeId = 'runtime-button';
  });
  return {analysis, document, previous: {...designSourceSnapshot(analysis), document: document.value}};
}

test('source edits retain guides and samples after semantic identity remapping, without importing live runtime IDs', () => {
  const {document, previous} = enriched();
  const text = source.replaceAll('action', 'command').replace('Width = 160', 'Width = 200');
  const analysis = readDesignSource(text, {previous});
  assert.equal(analysis.identityRemap.command, 'action');
  assert.deepEqual(analysis.document.designer, document.value.designer);
  assert.deepEqual(analysis.document.designTime, document.value.designTime);
  assert.deepEqual(analysis.document.designerOptions, {zoom: 1.5});
  assert.deepEqual(analysis.document.editorState, {tab: 'properties'});
  assert.equal(analysis.document.nodes.find(node => node.id === 'action').properties.Width, 200);
  assert.equal(analysis.document.nodes.find(node => node.id === 'action').properties.Content, 'Runtime');
  assert.equal(analysis.document.nodes.find(node => node.id === 'action').runtimeId, undefined);
});

test('source deletion removes only deleted-node samples and never reassigns them to surviving controls', () => {
  const {document, previous} = enriched();
  const text = source.split('\n').filter(line => !line.includes('var action') && !line.includes('Add(action)')).join('\n');
  const analysis = readDesignSource(text, {previous});
  assert.deepEqual(Object.keys(analysis.document.designTime.nodes), ['other']);
  assert.deepEqual(analysis.document.designTime.nodes.other, document.value.designTime.nodes.other);
  assert.deepEqual(analysis.document.designer, document.value.designer);
});

test('source type replacement does not apply samples intended for another control type', () => {
  const {previous} = enriched();
  const text = source.replace('new Button()', 'new TextBox()');
  const analysis = readDesignSource(text, {previous});
  assert.equal(analysis.document.designTime.nodes.action, undefined);
  assert.ok(analysis.document.designTime.nodes.other);
});

test('metadata-only plans retain staged samples without source edits or recompilation', () => {
  const {analysis, document} = enriched();
  const plan = planDesignSourceUpdate(analysis, document.value);
  assert.equal(plan.text, source);
  assert.equal(plan.changes.length, 0);
  assert.deepEqual(plan.document.designTime, document.value.designTime);
  assert.deepEqual(plan.document.designer, document.value.designer);
  assert.equal(plan.analysis.context, analysis.context);
  assert.equal(analysis.document.designTime, undefined);
  const empty = structuredClone(plan.document);
  delete empty.designTime;
  delete empty.designer;
  const cleared = planDesignSourceUpdate(plan.analysis, empty);
  assert.equal(cleared.document.designTime, undefined);
  assert.equal(cleared.document.designer, undefined);
});

test('history metadata retention clones both inputs and prunes samples for removed controls', () => {
  const {analysis, document} = enriched();
  const next = structuredClone(analysis.document);
  next.nodes = next.nodes.filter(node => node.id !== 'action');
  next.nodes.find(node => node.id === 'root').children = ['other'];
  const oldText = document.serialize();
  const nextText = JSON.stringify(next);
  const retained = retainDesignMetadata(document.value, next);
  assert.deepEqual(Object.keys(retained.designTime.nodes), ['other']);
  assert.deepEqual(retained.designer, document.value.designer);
  assert.equal(document.serialize(), oldText);
  assert.equal(JSON.stringify(next), nextText);
});

test('property plans preserve design metadata while changing only the owned C# token', () => {
  const {analysis, document} = enriched();
  document.setProperty('Width', 240, ['action']);
  const plan = planDesignSourceUpdate(analysis, document.value, source, {requireCompilation: true});
  assert.equal(plan.text, source.replace('Width = 160', 'Width = 240'));
  assert.deepEqual(plan.document.designTime, document.value.designTime);
  assert.deepEqual(plan.document.designer, document.value.designer);
});

test('clipboard carries referenced theme, converter and template resources plus selected samples', () => {
  const {document} = enriched();
  document.change('Resource dependencies', candidate => {
    candidate.resources = {
      WidthPreset: {kind: 'theme', type: 'double', variants: {default: 160, dark: 180}},
      Formatter: {kind: 'value', type: 'string', value: 'Converter configuration'},
      BorderBrush: {kind: 'value', type: MEDIA + 'Brush', value: normalizeDesignerBrush('#00aaff')},
      Unused: {kind: 'value', type: 'string', value: 'Not selected'}
    };
    const action = candidate.nodes.find(node => node.id === 'action');
    delete action.properties.Width;
    delete action.properties.Content;
    action.resourceReferences = {Width: {kind: 'theme', key: 'WidthPreset'}};
    action.bindings = {Content: {path: 'Caption', mode: 'OneWay', converter: 'Formatter'}};
    action.template = 'Frame';
    candidate.templates.Frame = {targetType: 'Button', root: {id: 'border', type: 'Border', properties: {}, children: [],
      resourceReferences: {Background: {kind: 'static', key: 'BorderBrush'}}}};
  });
  const original = document.serialize();
  const payload = JSON.parse(copyDesignSelection(document.value, ['action']));
  assert.deepEqual(Object.keys(payload.document.resources).sort(), ['BorderBrush', 'Formatter', 'WidthPreset']);
  for (const [key, value] of Object.entries(payload.document.resources)) assert.deepEqual(value, document.value.resources[key]);
  assert.equal(payload.document.nodes.find(node => node.id === 'action').bindings.Content.converter, 'Formatter');
  assert.equal(payload.document.templates.Frame.root.resourceReferences.Background.key, 'BorderBrush');
  assert.deepEqual(Object.keys(payload.document.designTime.nodes), ['action']);
  assert.equal(payload.document.nodes.find(node => node.id === 'action').runtimeId, undefined);
  assert.equal(document.serialize(), original);
});
