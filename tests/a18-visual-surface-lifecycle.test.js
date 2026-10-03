import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument} from '@sharpforge/designer';
import {DesignerSurfaceController} from '../apps/studio/designer-surface-controller.js';
import {DesignerSurfaceGeometry} from '../apps/studio/designer-surface-geometry.js';
import {DesignerAdornerLayer} from '../apps/studio/designer-surface-adorners.js';

function model() {
  const children = Array.from({length: 130}, (_, index) => ({id: `child${index}`, type: 'Button', children: [],
    properties: {Left: index * 4, Top: 0, Width: 24, Height: 20}}));
  return new DesignDocument({version: 1, name: 'Surface lifecycle', width: 800, height: 600, root: 'window',
    nodes: [{id: 'window', type: 'Window', properties: {}, children: ['canvas']},
      {id: 'canvas', type: 'Canvas', properties: {}, children: children.map(node => node.id)}, ...children]});
}

function browserDocument() {
  const document = {frames: new Map(), canceled: [], reads: 0, next: 0};
  document.defaultView = {
    requestAnimationFrame(callback) {
      assert.equal(this, document.defaultView, 'Scheduling must retain the owner window receiver.');
      const id = ++document.next;
      document.frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      assert.equal(this, document.defaultView, 'Cancellation must retain the scheduling window receiver.');
      document.canceled.push(id);
      document.frames.delete(id);
    },
    getComputedStyle(element) {
      assert.equal(this, document.defaultView, 'Measurement must use the mounted element window.');
      return {width: `${element.width}px`, height: `${element.height}px`, boxSizing: 'border-box', transform: 'none'};
    },
    performance: {now: () => document.reads * .25}
  };
  return document;
}

function mount(view, document, offset = 0) {
  const element = (width, height, left, parentElement = null) => ({
    ownerDocument: document, width, height, parentElement, isConnected: true, childNodes: [],
    getBoundingClientRect() {
      document.reads++;
      return {left: left + offset, top: 0, width, height};
    }
  });
  view.stage = element(800, 600, 0);
  const root = element(800, 600, 0, view.stage);
  const canvas = element(800, 600, 0, root);
  const elements = new Map([['window', root], ['canvas', canvas]]);
  for (let index = 0; index < 130; index++) elements.set(`child${index}`, element(24, 20, index * 4, canvas));
  view.host = {elements};
  return view.stage;
}

test('the complete surface controller constructs and disposes before mount without any browser globals', () => {
  const view = {document: model(), safe: callback => callback()};
  const controller = new DesignerSurfaceController(view);
  view.surface = controller;
  assert.equal(controller.geometry.baselines, null);
  controller.geometry.invalidate();
  assert.throws(() => controller.geometry.refresh(), {code: 'SFD_SURFACE_MOUNT'});
  controller.dispose();
  controller.dispose();
  controller.install();
  assert.equal(controller.disposed, true);
  assert.equal(controller.installed, false);
  assert.equal(controller.geometry.baselines, null);
  view.document.dispose();
});

test('first mounted refresh initializes browser ownership and preserves the unchanged geometry cache', () => {
  const view = {document: model(), safe: callback => callback()};
  const geometry = new DesignerSurfaceGeometry(view);
  const document = browserDocument();
  mount(view, document);
  geometry.refresh({all: true});
  const baseline = geometry.baselines;
  const entry = geometry.get('child1');
  const reads = document.reads;
  assert.equal(baseline.document, document);
  assert.equal(entry.rectangle.Width, 24);
  view.document.select('child1');
  geometry.refresh();
  assert.equal(geometry.get('child1'), entry);
  assert.equal(geometry.baselines, baseline);
  assert.equal(document.reads, reads, 'An unchanged mounted surface invalidated its geometry cache.');
  geometry.dispose();
  view.document.dispose();
});

test('a replaced surface cancels queued work on its original window and binds the new owner document', () => {
  const view = {document: model(), safe: callback => callback()};
  view.document.select('child1');
  const geometry = new DesignerSurfaceGeometry(view);
  const first = browserDocument();
  mount(view, first);
  geometry.refresh();
  assert.equal(first.frames.size, 1);
  const frame = geometry.frame;
  const baseline = geometry.baselines;
  baseline.fonts.set('prior font', {});
  const second = browserDocument();
  mount(view, second, 100);
  geometry.refresh();
  assert.deepEqual(first.canceled, [frame]);
  assert.equal(first.frames.size, 0);
  assert.equal(baseline.fonts.size, 0);
  assert.notEqual(geometry.baselines, baseline);
  assert.equal(geometry.baselines.document, second);
  assert.equal(geometry.stage.matrix[4], 100);
  assert.equal(second.frames.size, 1);
  delete view.stage;
  geometry.invalidate();
  assert.equal(second.frames.size, 0, 'A missing stage prevented cancellation on the original frame window.');
  geometry.dispose();
  view.document.dispose();
});

test('replacing a stage in the same document refreshes coordinates and retains its font metrics cache', () => {
  const view = {document: model(), safe: callback => callback()};
  const geometry = new DesignerSurfaceGeometry(view);
  const document = browserDocument();
  mount(view, document);
  geometry.refresh({all: true});
  const baseline = geometry.baselines;
  const entry = geometry.get('child1');
  mount(view, document, 75);
  geometry.refresh({all: true});
  assert.equal(geometry.baselines, baseline);
  assert.notEqual(geometry.get('child1'), entry);
  assert.equal(geometry.stage.matrix[4], 75);
  geometry.dispose();
  view.document.dispose();
});

test('queued adorners can be disposed after the mounted stage has been removed', () => {
  const document = browserDocument();
  const view = {stage: {ownerDocument: document}, safe: callback => callback()};
  const adorners = new DesignerAdornerLayer(view, {});
  adorners.request();
  const frame = adorners.frame;
  delete view.stage;
  adorners.dispose();
  assert.deepEqual(document.canceled, [frame]);
  assert.equal(document.frames.size, 0);
});
