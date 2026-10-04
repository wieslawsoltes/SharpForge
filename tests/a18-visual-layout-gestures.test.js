import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesign, DesignDocument, DesignMarginSession, DesignOrderSession, convertCanvasToGrid,
  reorderDesignSelection} from '@sharpforge/designer';
import {DesignerMarginDrag, marginLayoutBounds} from '../apps/studio/designer-surface-margin.js';
import {DesignerSurfaceGestures} from '../apps/studio/designer-surface-gestures.js';
import {DesignerSurfaceController} from '../apps/studio/designer-surface-controller.js';
import {DesignerAccessibility} from '../apps/studio/designer-accessibility.js';

function marginDocument() {
  const document = new DesignDocument(createDesign());
  convertCanvasToGrid(document, {id: 'canvas'});
  document.setProperty('Margin', [8, 12, 16, 20], ['action']);
  document.select('action');
  return document;
}

test('rotated/scaled parent margin drag previews repeated moves and commits exactly once', () => {
  const document = marginDocument();
  const before = document.snapshot();
  const history = document.undoStack.length;
  const gesture = new DesignMarginSession(document, {id: 'action', side: 'left',
    matrix: [0, 2, -2, 0, 100, 200], start: {x: 100, y: 200}});
  for (let index = 1; index <= 100; index++) gesture.update({x: 100, y: 200 + index * .32}, {gridSize: 8});
  assert.equal(gesture.next.Left, 24);
  assert.deepEqual(document.snapshot(), before);
  gesture.commit();
  assert.equal(document.node('action').properties.Margin.Left, 24);
  assert.equal(document.undoStack.length, history + 1);
  document.undo();
  assert.deepEqual(document.snapshot(), before);
  document.undo(true);
  assert.equal(document.node('action').properties.Margin.Left, 24);
});

test('trailing margins invert deltas, Alt keeps fractional values, cancellation and stale edits do not commit', () => {
  const document = marginDocument();
  const before = document.snapshot();
  const settings = {id: 'action', side: 'right', matrix: [2, 0, 0, 2, 0, 0], start: {x: 0, y: 0}};
  const gesture = new DesignMarginSession(document, settings);
  gesture.update({x: 5, y: 0}, {gridSize: 8, disabled: true});
  assert.equal(gesture.next.Right, 13.5);
  gesture.cancel();
  assert.deepEqual(document.snapshot(), before);
  assert.throws(() => gesture.commit(), {code: 'SFD_ANCHOR_ENDED'});
  const stale = new DesignMarginSession(document, settings);
  stale.update({x: 24, y: 0});
  document.setProperty('Content', 'Concurrent edit', ['action']);
  const current = document.snapshot();
  assert.throws(() => stale.commit(), /changed/);
  assert.deepEqual(document.snapshot(), current);
  assert.throws(() => new DesignMarginSession(document, {...settings, canEdit: () => false}), {code: 'SFD_ANCHOR_READ_ONLY'});
  assert.throws(() => new DesignMarginSession(new DesignDocument(createDesign()), settings), {code: 'SFD_ANCHOR_PARENT'});
});

test('anchor pointer path distinguishes drag, toggle click and cancellation without publishing preview values', () => {
  const document = marginDocument();
  const before = document.snapshot();
  const calls = [];
  let handlers;
  const element = {style: {margin: '12px 16px 20px 8px'}};
  const controller = {view: {document, sourceSync: {}, outline: {isLocked: () => false}},
    finishKeyboard() {}, anchor: (id, side) => calls.push([id, side]), drawAdorners() {},
    geometry: {get: () => ({element, parentMatrix: [0, 2, -2, 0, 100, 200]}), remeasure() {}},
    adorners: {paint() {}}, trackPointer: (event, move, done, cancel) => { handlers = {move, done, cancel}; }};
  const drag = new DesignerMarginDrag(controller);
  const start = {clientX: 100, clientY: 200};
  drag.begin(start, 'action', 'left');
  handlers.move({clientX: 100, clientY: 232, altKey: false});
  assert.deepEqual(document.snapshot(), before);
  assert.equal(element.style.margin, '12px 16px 20px 24px');
  handlers.done();
  assert.equal(document.node('action').properties.Margin.Left, 24);
  document.undo();
  drag.begin(start, 'action', 'left');
  handlers.move({clientX: 100, clientY: 248, altKey: false});
  handlers.cancel();
  assert.deepEqual(document.snapshot(), before);
  assert.equal(element.style.margin, '12px 16px 20px 8px');
  drag.begin(start, 'action', 'left');
  handlers.done();
  assert.deepEqual(calls, [['action', 'left']]);
  assert.deepEqual(document.snapshot(), before);
});

test('Grid anchors use their occupied cell and preserve padding, gaps and spanning geometry', () => {
  const entry = {node: {properties: {Column: 1, Row: 1, ColumnSpan: 2}},
    rectangle: {Left: 132, Top: 68, Width: 80, Height: 30}};
  const parent = {node: {type: 'Microsoft.UI.Xaml.Controls.Grid'}, width: 620, height: 205,
    style: {gridTemplateColumns: '100px 200px 300px', gridTemplateRows: '50px 150px', columnGap: '10px', rowGap: '5px',
      paddingLeft: '8px', borderLeftWidth: '2px', paddingTop: '4px', borderTopWidth: '1px'}};
  assert.deepEqual(marginLayoutBounds(entry, parent), {
    bounds: {Left: 12, Top: 8, Width: 80, Height: 30}, parentBounds: {Width: 510, Height: 150}
  });
});

test('held ordering keeps stable block order and creates only one optimistic history entry', () => {
  const document = new DesignDocument(createDesign());
  assert.throws(() => reorderDesignSelection(document, 'unknown'), {code: 'SFD_ORDER_ACTION'});
  document.select(['title', 'caption']);
  const before = document.snapshot();
  const gesture = new DesignOrderSession(document);
  for (let repeat = 0; repeat < 100; repeat++) gesture.update('forward');
  assert.deepEqual(gesture.next, ['action', 'title', 'caption']);
  assert.deepEqual(document.snapshot(), before);
  gesture.commit();
  assert.equal(document.undoStack.length, 1);
  assert.deepEqual(document.node('canvas').children, ['action', 'title', 'caption']);
  assert.deepEqual(document.node('canvas').children.map(id => document.node(id).properties.ZIndex), [0, 1, 2]);
  document.undo();
  assert.deepEqual(document.snapshot(), before);
  const cancelled = new DesignOrderSession(document);
  cancelled.update('front');
  cancelled.cancel();
  assert.deepEqual(document.snapshot(), before);
  assert.throws(() => new DesignOrderSession(document, {canEdit: id => id !== 'canvas'}), {code: 'SFD_ORDER_READ_ONLY'});
  const stale = new DesignOrderSession(document);
  stale.update('front');
  document.setProperty('Content', 'New', ['action']);
  assert.throws(() => stale.commit(), /changed/);
});

function orderController() {
  const document = new DesignDocument(createDesign());
  document.select('title');
  const parent = {children: [], get firstChild() { return this.children[0] ?? null; }, insertBefore(element, before) {
    this.children.splice(this.children.indexOf(element), 1);
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, element);
  }};
  const elements = new Map(document.node('canvas').children.map(id => {
    const element = {id, parentElement: parent, style: {zIndex: ''}, get nextSibling() {
      return parent.children[parent.children.indexOf(this) + 1] ?? null;
    }};
    parent.children.push(element);
    return [id, element];
  }));
  const controller = {view: {document, host: {elements}, outline: {assertEditable() {}, isLocked: () => false}},
    geometry: {invalidate() {}}, adorners: {paint() {}}, drawAdorners() {}};
  controller.gestures = new DesignerSurfaceGestures(controller);
  return {controller, document, parent};
}

test('Alt-arrow accessibility dispatch previews actual sibling order until the surface keyup flush', () => {
  const {controller, document, parent} = orderController();
  controller.view.safe = callback => callback();
  controller.view.surface = {orderKey: (event, delta) => controller.gestures.orderKey(event, delta)};
  const accessibility = new DesignerAccessibility(controller.view);
  const before = document.snapshot();
  const event = {key: 'ArrowRight', altKey: true, target: {closest: () => null}, preventDefault() {}, stopPropagation() {}};
  for (let repeat = 0; repeat < 32; repeat++) assert.equal(accessibility.handleKey(event), true);
  assert.deepEqual(parent.children.map(element => element.id), ['caption', 'action', 'title']);
  assert.deepEqual(document.snapshot(), before);
  controller.gestures.finishKeyboard();
  assert.equal(document.undoStack.length, 1);
  document.undo();
  assert.deepEqual(document.snapshot(), before);
});

test('Escape cancels pending surface geometry before accessibility parent navigation consumes the key', () => {
  const calls = [];
  const controller = {gestures: {keyboard: {}}, view: {accessibility: {handleKey() { throw new Error('Navigation consumed cancellation'); }}},
    finishKeyboard: cancel => calls.push(cancel)};
  const event = {key: 'Escape', preventDefault() {}, stopPropagation() {}};
  assert.equal(DesignerSurfaceController.prototype.keydown.call(controller, event), true);
  assert.deepEqual(calls, [true]);
});
