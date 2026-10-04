import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignSpatialIndex} from '@sharpforge/designer';
import {DesignerAdornerLayer} from '../apps/studio/designer-surface-adorners.js';
import {sessionDom} from './fixtures/a18-session-dom.js';

function fixture() {
  const {document} = sessionDom();
  const create = document.createElement;
  document.createElement = tag => {
    const element = create(tag);
    Object.defineProperty(element, 'firstChild', {get: () => element.children[0] ?? null});
    return element;
  };
  const stage = document.createElement('div');
  const overlay = document.createElement('div');
  stage.append(overlay);
  document.body.append(stage);
  const parent = {id: 'root', type: 'Microsoft.UI.Xaml.Controls.Canvas', properties: {}};
  const index = new DesignSpatialIndex();
  const entries = new Map();
  for (let offset = 0; offset < 5000; offset++) {
    const id = `n${offset}`;
    const rectangle = {Left: offset % 100 * 10, Top: Math.floor(offset / 100) * 10, Width: 20, Height: 10};
    index.set(id, rectangle);
    entries.set(id, {id, rectangle, bounds: rectangle, node: {id, properties: {Name: id}},
      stageMatrix: [1, 0, 0, 1, rectangle.Left, rectangle.Top], parentMatrix: [1, 0, 0, 1, 0, 0]});
  }
  const view = {stage, overlay, initialized: true, preview: false, mode: 'layout',
    outline: {isVisible: () => true, isLocked: () => false},
    document: {selection: ['n2500'], value: {root: 'root'}, parent: () => parent}};
  const geometry = {index, entries, refresh() {}, stageInverse: [1, 0, 0, 1, 0, 0],
    visibleBounds: () => ({Left: 0, Top: 0, Width: 1000, Height: 500}),
    get: id => id === 'root' ? {width: 1000, height: 500, stageMatrix: [1, 0, 0, 1, 0, 0]} : entries.get(id)};
  const layer = new DesignerAdornerLayer(view, geometry);
  return {view, geometry, layer};
}

test('single-control drag retains its label and box without scanning the 5000-node spatial index', () => {
  const {view, geometry, layer} = fixture();
  geometry.index.search = () => { throw new Error('A one-control drag enumerated the scene.'); };
  layer.paint();
  const box = layer.boxes.get('n2500');
  const label = box.firstChild;
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(label), 'textContent');
  let writes = 0;
  Object.defineProperty(label, 'textContent', {get: () => descriptor.get.call(label), set(value) {
    writes++;
    descriptor.set.call(label, value);
  }});
  for (let offset = 0; offset < 200; offset++) {
    layer.paint({n2500: {...geometry.entries.get('n2500').rectangle, Left: offset / 2}});
  }
  assert.equal(writes, 0, 'Moving a fixed-size control replaced an unchanged measurement label.');
  assert.equal(layer.boxes.get('n2500'), box);
  assert.equal(box.firstChild, label);
  assert.equal(view.overlay.dataset.visibleSelection, '1');
  assert.equal(view.overlay.dataset.selectionCount, '1');
  layer.paint({n2500: {...geometry.entries.get('n2500').rectangle, Width: 25}});
  assert.equal(writes, 1, 'A real size change must still refresh the measurement label.');
  layer.dispose();
  assert.equal(view.overlay.children.length, 0);
});

test('large and hidden selections preserve clipping, visibility and the 200-adorner bound', () => {
  const {view, geometry, layer} = fixture();
  view.document.selection = [...geometry.entries.keys()];
  layer.paint();
  assert.equal(layer.boxes.size, 200);
  assert.equal(view.overlay.dataset.selectionCount, '5000');
  view.document.selection = ['n1'];
  view.outline.isVisible = () => false;
  layer.paint();
  assert.equal(layer.boxes.size, 0);
  view.outline.isVisible = () => true;
  geometry.visibleBounds = () => ({Left: 2000, Top: 2000, Width: 10, Height: 10});
  layer.paint();
  assert.equal(layer.boxes.size, 0);
  layer.dispose();
});

test('smart-guide elements update in place, clear old axis styles and release on disposal', () => {
  const {view, layer} = fixture();
  const guides = offset => [{axis: 'x', position: 100 + offset, kind: 'edge'},
    {axis: 'y', position: 200 + offset, kind: 'spacing', gap: 10}];
  layer.guides(guides(0), 'root');
  const group = layer.guideGroup;
  const first = layer.guideLines[0];
  const second = layer.guideLines[1];
  let removes = 0;
  const original = group.remove.bind(group);
  group.remove = () => { removes++; original(); };
  for (let offset = 0; offset < 200; offset++) layer.guides(guides(offset), 'root');
  assert.equal(removes, 0, 'Each drag frame detached the complete smart-guide subtree.');
  assert.equal(layer.guideGroup, group);
  assert.equal(layer.guideLines[0], first);
  assert.equal(layer.guideLines[1], second);
  assert.equal(group.children.length, 2);
  assert.equal(first.style.left, '299px');
  assert.equal(second.style.top, '399px');
  layer.guides([{axis: 'y', position: 30, kind: 'baseline'}], 'root');
  assert.equal(first.style.borderLeft, '');
  assert.equal(first.style.height, '');
  assert.equal(first.style.top, '30px');
  assert.equal(first.style.width, '1000px');
  assert.equal(group.children.length, 1);
  layer.guides([], null);
  assert.equal(group.hidden, true);
  layer.guides(guides(0), 'root');
  assert.equal(group.hidden, false);
  assert.equal(group.children.length, 2);
  layer.guides(guides(0), 'missing');
  assert.equal(group.hidden, true, 'A missing rendered parent retained stale visible guides.');
  layer.dispose();
  assert.equal(layer.guideGroup, null);
  assert.equal(layer.guideLines.length, 0);
  assert.equal(view.overlay.children.length, 0);
});
