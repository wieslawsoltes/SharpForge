import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, createDesign} from '@sharpforge/designer';

function documentFor(context, value = createDesign('Property delta proof')) {
  const document = new DesignDocument(value);
  context.after(() => document.dispose());
  return document;
}

test('A18 a 5000-control property patch matches the full validator and retains untouched namespaces', context => {
  const value = createDesign('Large property transaction');
  const canvas = value.nodes.find(node => node.id === 'canvas');
  for (let index = value.nodes.length; index < 5000; index++) {
    const id = 'item' + index;
    value.nodes.push({id, type: 'TextBlock', properties: {Text: id, Left: index % 640, Top: index % 480, Width: 100}, children: []});
    canvas.children.push(id);
  }
  const document = documentFor(context, value);
  const reference = documentFor(context, value);
  const before = document.snapshot();
  const unchanged = document.node('item4999');
  const children = document.node('canvas').children;
  const styles = document.value.styles;
  const events = [];
  context.after(document.subscribe(event => events.push(event)));
  assert.equal(document.patchProperties({item5: {Left: '23', Top: 45}, item4998: {Width: 101}}), true);
  reference.change('Equivalent full edit', candidate => {
    candidate.nodes.find(node => node.id === 'item5').properties.Left = 23;
    candidate.nodes.find(node => node.id === 'item5').properties.Top = 45;
    candidate.nodes.find(node => node.id === 'item4998').properties.Width = 101;
  });
  assert.deepEqual(document.snapshot(), reference.snapshot());
  assert.equal(document.node('item4999'), unchanged);
  assert.equal(document.node('canvas').children, children);
  assert.equal(document.value.styles, styles);
  assert.deepEqual(events[0].changes, {kind: 'properties', nodes: [
    {id: 'item5', properties: ['Left', 'Top']}, {id: 'item4998', properties: ['Width']}
  ]});
  assert.equal(document.undo(), true);
  assert.deepEqual(document.snapshot(), before);
  assert.equal(document.undo(true), true);
  assert.deepEqual(document.snapshot(), reference.snapshot());
});

test('A18 semantically equal external node replacement requires full reindexing before a property commit', context => {
  const document = documentFor(context);
  const events = [];
  context.after(document.subscribe(event => events.push(event)));
  const oldAction = document.node('action');
  document.value.nodes = structuredClone(document.value.nodes);
  assert.equal(document.patchProperties({caption: {Top: 120}}), true);
  assert.equal(events[0].changes, undefined);
  assert.notEqual(document.node('action'), oldAction);
  assert.equal(document.node('action'), document.value.nodes.find(node => node.id === 'action'));
  document.node('action').runtimeId = 0;
  assert.equal(document.value.nodes.find(node => node.id === 'action').runtimeId, 0);
  document.undo();
  assert.equal(document.node('action').runtimeId, 0);
  assert.equal(document.node('caption').properties.Top, 103);
});

test('A18 a permission callback cannot invalidate the baseline proof before an incremental event is emitted', context => {
  const document = documentFor(context);
  const events = [];
  context.after(document.subscribe(event => events.push(event)));
  assert.equal(document.patchProperties({action: {Width: 200}}, {canEdit: () => {
    document.node('caption').properties.Top = 125;
    return true;
  }}), true);
  assert.equal(document.node('caption').properties.Top, 125);
  assert.equal(events[0].changes, undefined);
  document.undo();
  assert.equal(document.node('action').properties.Width, 160);
  assert.equal(document.node('caption').properties.Top, 125);
});
