import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, createDesign} from '@sharpforge/designer';
import {CONTROLS, MEDIA} from '@sharpforge/framework';

function fixture(context, value = createDesign('Property transaction atomicity')) {
  const document = new DesignDocument(value);
  context.after(() => document.dispose());
  const events = [];
  context.after(document.subscribe(event => events.push(structuredClone(event))));
  return {document, events};
}

function capturedState(document, events) {
  return {value: document.snapshot(), revision: document.revision, savedRevision: document.savedRevision,
    selection: [...document.selection], undo: structuredClone(document.undoStack), redo: structuredClone(document.redoStack),
    events: structuredClone(events)};
}

function assertAtomicRejection(document, events, operation, error) {
  const before = capturedState(document, events);
  const value = document.value;
  const indexedNodes = new Map(document.value.nodes.map(node => [node.id, document.node(node.id)]));
  assert.throws(operation, error);
  assert.deepEqual(capturedState(document, events), before);
  assert.equal(document.value, value);
  for (const [id, node] of indexedNodes) assert.equal(document.node(id), node);
}

test('A18 property undo and redo reject a current control type replacement despite a stale node index', context => {
  for (const redo of [false, true]) {
    const {document, events} = fixture(context);
    document.patchProperties({action: {Width: 240}});
    if (redo) document.undo();
    const index = document.value.nodes.findIndex(node => node.id === 'action');
    document.value.nodes[index] = {id: 'action', type: CONTROLS + 'TextBlock',
      properties: {Text: 'Replacement control', Width: 300}, children: [], events: {}};
    assertAtomicRejection(document, events, () => document.undo(redo), /history target.*another type/);
    assert.equal(document.value.nodes[index].properties.Width, 300);
  }
});

test('A18 property history distinguishes project control identities sharing the same preview base type', context => {
  for (const redo of [false, true]) {
    const value = createDesign('Project identity history');
    value.projectTypes = [
      {type: 'App.FirstButton', baseType: CONTROLS + 'Button'},
      {type: 'App.SecondButton', baseType: CONTROLS + 'Button'}
    ];
    value.nodes.find(node => node.id === 'action').projectType = 'App.FirstButton';
    const {document, events} = fixture(context, value);
    document.patchProperties({action: {Width: 240}});
    if (redo) document.undo();
    const index = document.value.nodes.findIndex(node => node.id === 'action');
    document.value.nodes[index] = {...document.value.nodes[index], projectType: 'App.SecondButton'};
    assertAtomicRejection(document, events, () => document.undo(redo), /history target.*another type/);
    assert.equal(document.value.nodes[index].projectType, 'App.SecondButton');
  }
});

test('A18 property history resolves current controls after external array reordering through full validation', context => {
  const {document, events} = fixture(context);
  document.patchProperties({action: {Width: 240}});
  document.value.nodes.reverse();
  assert.equal(document.undo(), true);
  assert.equal(document.node('action').properties.Width, 160);
  assert.equal(events.at(-1).changes, undefined);
  for (const node of document.value.nodes) assert.equal(document.node(node.id), node);
  assert.equal(document.undo(true), true);
  assert.equal(document.node('action').properties.Width, 240);
});

test('A18 sparse normalized property values reject before publishing data, indexes or history', context => {
  const {document, events} = fixture(context);
  document.patchProperties({caption: {Top: 125}});
  document.undo();
  const changes = [
    {action: {Padding: Array(4)}},
    {action: {Background: {valueType: MEDIA + 'LinearGradientBrush', GradientStops: Array(2)}}},
    {caption: {Top: 140}, action: {Padding: Array(4)}}
  ];
  for (const patch of changes) assertAtomicRejection(document, events, () => document.patchProperties(patch), TypeError);
  assert.equal(document.redoStack.length, 1);
  assert.equal(document.undo(true), true);
  assert.equal(document.node('caption').properties.Top, 125);
});
