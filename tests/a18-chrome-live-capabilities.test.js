import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, DesignerAppSessions, LiveDesignAttachment, LiveDesignCapabilityError,
  createDesign, designPatch, designScene, normalizeDesignerBrush, track
} from '@sharpforge/designer';
import {CONTROLS, MEDIA} from '@sharpforge/framework';

function baseline() {
  const document = new DesignDocument(createDesign('Live capabilities'));
  document.add('ComboBox', 'canvas', {Name: 'Choices'});
  document.add('Grid', 'canvas', {Name: 'LayoutGrid'});
  return document.snapshot();
}

const node = (document, name) => document.nodes.find(item => item.id === name || item.properties.Name === name);
const brush = () => normalizeDesignerBrush({valueType: MEDIA + 'LinearGradientBrush',
  GradientStops: [{Offset: 0, Color: '#ff0000'}, {Offset: 1, Color: '#0000ff'}]});
const states = [{name: 'CommonStates', states: [{name: 'Focused', setters: [{target: 'action', property: 'Width', value: 180}]}]}];
const edits = {
  resources: document => { document.resources = {Label: {type: 'string', value: 'New'}}; },
  themeResources: document => { document.themeResources = {Dark: {Label: 'New'}}; },
  visualStates: document => { document.visualStates = states; },
  responsive: document => { document.responsive = {version: 1, states: [{id: 'Wide', minWidth: 600, overrides: {action: {Width: 300}}}]}; },
  bindings: document => {
    delete node(document, 'action').properties.Content;
    node(document, 'action').bindings = {Content: {path: 'Customer.Name', mode: 'OneWay'}};
  },
  resourceReferences: document => {
    document.resources = {Label: {type: 'string', value: 'New'}};
    delete node(document, 'action').properties.Content;
    node(document, 'action').resourceReferences = {Content: {kind: 'static', key: 'Label'}};
  },
  states: document => { node(document, 'action').states = structuredClone(states); },
  events: document => { node(document, 'action').events.Click = 'Program.AnotherHandler'; },
  projectType: document => {
    document.projectTypes = [{type: 'Demo.Custom', baseType: CONTROLS + 'UserControl'}];
    document.nodes.push({id: 'custom', type: CONTROLS + 'UserControl', projectType: 'Demo.Custom', properties: {}, children: []});
    node(document, 'canvas').children.push('custom');
  },
  'value.gradient': document => { node(document, 'action').properties.Background = brush(); },
  'collection.RowDefinitions': document => {
    node(document, 'LayoutGrid').collections = {RowDefinitions: [{type: 'RowDefinition', properties: {Height: track('*')}}]};
  },
  'template.states': document => {
    document.templates.Frame = {targetType: 'Button', root: {id: 'frame', type: 'Border', properties: {}, children: []},
      states: [{name: 'Common', states: [{name: 'Focused', setters: [{target: 'frame', property: 'Opacity', value: 0.5}]}]}]};
    node(document, 'action').template = 'Frame';
  },
  'template.collections': document => {
    document.templates.Frame = {targetType: 'Button', root: {id: 'choices', type: 'ComboBox', properties: {},
      collections: {Items: ['Unavailable template item']}, children: []}};
    node(document, 'action').template = 'Frame';
  }
};

async function attached() {
  const before = baseline();
  const sessions = new DesignerAppSessions();
  const calls = [];
  const sourceWrites = [];
  const compiles = [];
  sessions.register({sessionId: 'selected', generation: 4, uiActive: true, state: 'paused', codeVersion: 1,
    compile: async options => { compiles.push(options); return {success: true, image: {}}; },
    request: async (method, parameters) => {
      calls.push({method, parameters});
      if (method === 'designSnapshot') return {scene: designScene(before), revision: 2};
      return {revision: 3, bindings: parameters.patch?.bindings ?? {}, codeVersion: 2};
    }});
  const attachment = new LiveDesignAttachment(sessions);
  const {document} = await attachment.attach('selected', {linkedDocument: before});
  calls.length = 0;
  return {attachment, document, calls, sourceWrites, compiles};
}

for (const [capability, edit] of Object.entries(edits)) {
  test('unsupported ' + capability + ' remains staged and fails before apply or Hot Reload dispatch', async () => {
    const {attachment, document, calls, sourceWrites, compiles} = await attached();
    const target = attachment.target;
    const original = structuredClone(target.baseline);
    edit(document);
    const staged = structuredClone(document);
    const reject = error => error instanceof LiveDesignCapabilityError && !error.sourceWritten && !error.codeApplied &&
      error.diagnostics.some(diagnostic => diagnostic.capability === capability && diagnostic.code === 'SFDL0010' &&
        diagnostic.severity === 'error' && diagnostic.source === 'Designer' && diagnostic.fixHint);
    await assert.rejects(attachment.apply(document), reject);
    await assert.rejects(attachment.hotReload(document, {writeSource: async options => sourceWrites.push(options)}), reject);
    assert.deepEqual(calls, []);
    assert.deepEqual(sourceWrites, []);
    assert.deepEqual(compiles, []);
    assert.deepEqual(document, staged);
    assert.equal(attachment.target, target);
    assert.deepEqual(target.baseline, original);
    assert.equal(target.sceneRevision, 2);
    assert.equal(attachment.busy, false);
  });
}

test('unchanged unsupported authoring metadata does not block an unrelated scalar edit', () => {
  const before = baseline();
  edits.resources(before);
  edits.bindings(before);
  edits.states(before);
  edits.responsive(before);
  const after = structuredClone(before);
  node(after, 'action').properties.Width = 213;
  assert.deepEqual(designPatch(before, after).commands, [{op: 'set', id: 'action', property: 'Width', value: 213}]);
});

test('preview samples never produce runtime commands or overwrite live input', () => {
  const before = baseline();
  const after = structuredClone(before);
  after.designTime = {version: 1, nodes: {action: {properties: {Content: 'Preview example'}}}};
  assert.deepEqual(designPatch(before, after).commands, []);
});

test('metadata-declared scalar/object Items produce a real collection command and preserve runtime id zero', () => {
  const before = baseline();
  const choices = node(before, 'Choices');
  choices.collections = {Items: ['First']};
  choices.runtimeId = 0;
  const after = structuredClone(before);
  node(after, 'Choices').collections.Items = [true, {type: CONTROLS + 'ComboBoxItem', properties: {Content: 'Second'}}];
  const patch = designPatch(before, after);
  assert.equal(patch.bindings[choices.id], 0);
  assert.deepEqual(patch.commands, [{op: 'collection', id: choices.id, property: 'Items', previous: ['First'],
    items: [true, {type: CONTROLS + 'ComboBoxItem', properties: {Content: 'Second'}}]}]);
});

test('new collection item gradients are diagnosed before constructing any runtime item', () => {
  const before = baseline();
  const after = structuredClone(before);
  node(after, 'Choices').collections = {Items: [{type: CONTROLS + 'ComboBoxItem', properties: {Background: brush()}}]};
  assert.throws(() => designPatch(before, after), error => error.code === 'SFDL0010' &&
    error.diagnostics.some(diagnostic => diagnostic.itemIndex === 0 && diagnostic.capability === 'value.gradient'));
});

test('an app ownership rejection occurs before the source callback as well as before compilation and worker dispatch', async () => {
  const {attachment, document, calls, sourceWrites, compiles} = await attached();
  attachment.sessions.get('selected').assertSourceOwnership = () => {
    const error = new Error('This app belongs to another source projection');
    error.code = 'SFDA0012';
    throw error;
  };
  await assert.rejects(attachment.hotReload(document, {writeSource: async options => sourceWrites.push(options)}),
    error => error.code === 'SFDA0012' && error.sourceWritten === false && error.codeApplied === false);
  assert.deepEqual(calls, []);
  assert.deepEqual(sourceWrites, []);
  assert.deepEqual(compiles, []);
});
