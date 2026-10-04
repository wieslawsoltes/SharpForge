import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, designerPropertyRows, designerPropertySchema} from '@sharpforge/designer';
import {CONTROLS} from '@sharpforge/framework';

function fixture() {
  return new DesignDocument({version: 1, name: 'Property parent contexts', width: 960, height: 640, root: 'window',
    nodes: [
      {id: 'window', type: 'Window', properties: {}, children: ['layout']},
      {id: 'layout', type: 'StackPanel', properties: {}, children: ['canvas', 'grid', 'wrap']},
      {id: 'canvas', type: 'Canvas', properties: {}, children: ['canvasButton']},
      {id: 'grid', type: 'Grid', properties: {}, children: ['gridButton']},
      {id: 'wrap', type: 'VariableSizedWrapGrid', properties: {}, children: ['wrapButton']},
      ...['canvasButton', 'gridButton', 'wrapButton'].map(id => ({id, type: 'Button', properties: {}, children: []}))
    ], styles: {}, templates: {}});
}

function names(document, ids, options) {
  return new Set(designerPropertyRows(document.value, ids, options).map(row => row.name));
}

const canvas = ['Left', 'Top', 'ZIndex'];
const grid = ['Row', 'Column', 'RowSpan', 'ColumnSpan'];
const wrap = ['WrapRowSpan', 'WrapColumnSpan'];

function placement(actual, present, absent) {
  for (const name of present) assert(actual.has(name), 'Expected visible ' + name);
  for (const name of absent) assert(!actual.has(name), 'Expected context to hide unset ' + name);
  assert(actual.has('Width'));
}

test('Canvas children expose Canvas placement while retaining complete framework metadata', () => {
  const document = fixture();
  placement(names(document, ['canvasButton']), canvas, [...grid, ...wrap]);
  assert.equal(designerPropertySchema('Button').ColumnSpan.owner, CONTROLS + 'Grid');
  assert.equal(designerPropertySchema('Button').WrapColumnSpan.owner, CONTROLS + 'VariableSizedWrapGrid');
});

test('Grid and VariableSizedWrapGrid expose distinct owner-specific attached setters', () => {
  const document = fixture();
  placement(names(document, ['gridButton']), grid, [...canvas, ...wrap]);
  placement(names(document, ['wrapButton']), wrap, [...canvas, ...grid]);
});

test('mixed parents keep placement relevant to either selected parent without unrelated setters', () => {
  const document = fixture();
  placement(names(document, ['canvasButton', 'gridButton']), [...canvas, ...grid], wrap);
  placement(names(document, ['gridButton', 'wrapButton']), [...grid, ...wrap], canvas);
  placement(names(document, ['canvasButton', 'gridButton', 'wrapButton']), [...canvas, ...grid, ...wrap], []);
});

test('unset layout properties stay hidden without a matching parent and explicit search discovers them', () => {
  const document = fixture();
  placement(names(document, ['layout']), [], [...canvas, ...grid, ...wrap]);
  assert.deepEqual([...names(document, ['canvasButton'], {search: 'ColumnSpan', arrange: 'name'})],
    ['ColumnSpan', 'WrapColumnSpan']);
  assert.deepEqual(designerPropertyRows(document.value, []), []);
});

test('local off-context values remain inspectable and disappear after reset', () => {
  const document = fixture();
  document.setProperty('ColumnSpan', 3, ['canvasButton']);
  const before = document.serialize();
  const row = designerPropertyRows(document.value, ['canvasButton']).find(item => item.name === 'ColumnSpan');
  assert.equal(row.value, 3);
  assert.equal(row.source.kind, 'local');
  assert.equal(document.serialize(), before, 'Property discovery must not mutate the design');
  document.setProperty('ColumnSpan', undefined, ['canvasButton']);
  assert(!names(document, ['canvasButton']).has('ColumnSpan'));
});

test('inherited style values and protected C# expressions remain visible outside their layout context', () => {
  const document = fixture();
  document.setStyle('Placement', {targetType: 'Button', setters: {Row: 2}});
  document.setReference('style', 'Placement', ['canvasButton']);
  const rows = designerPropertyRows(document.value, ['canvasButton'], {sourceBindings: {
    canvasButton: {properties: {ColumnSpan: {dynamic: true}}}
  }});
  assert.equal(rows.find(row => row.name === 'Row').source.kind, 'style');
  assert.equal(rows.find(row => row.name === 'ColumnSpan').protectedSource, true);
  assert(!rows.some(row => row.name === 'WrapColumnSpan'));
});
