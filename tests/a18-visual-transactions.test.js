import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, createDesign, DesignGeometrySession, arrangeDesignSelection, reorderDesignSelection,
  setUserGuide, guideSettings, createDrawnControl, toggleDesignAnchor, designAnchors, resetDesignLayout} from '@sharpforge/designer';

const fixture = () => new DesignDocument(createDesign('Visual transactions'));
const bounds = (document, id) => {
  const properties = document.node(id).properties;
  return Object.fromEntries(['Left', 'Top', 'Width', 'Height'].map(key => [key, properties[key] ?? 0]));
};

test('200 transformed pointer events commit one exact undo and redo operation', () => {
  const document = fixture();
  document.select('action');
  const before = document.serialize();
  const gesture = new DesignGeometrySession(document, {rectangles: {action: bounds(document, 'action')},
    matrices: {action: [0, 4, -6, 0, 100, 120]}, start: {x: 100, y: 120}, handle: 'se'});
  for (let event = 1; event <= 200; event++) gesture.update({x: 100 - event * .5, y: 120 + event * .25});
  assert.equal(document.serialize(), before);
  assert.equal(gesture.commit(), true);
  assert.equal(document.undoStack.length, 1);
  assert.equal(document.node('action').properties.Width, 172.5);
  assert(Math.abs(document.node('action').properties.Height - 40 - 100 / 6) < 1e-9);
  const after = document.serialize();
  document.undo();
  assert.equal(document.serialize(), before);
  document.undo(true);
  assert.equal(document.serialize(), after);
});

test('Escape/cancel/dispose preserve exact serialized state and produce no history entry', () => {
  for (const finish of ['cancel', 'dispose']) {
    const document = fixture();
    const before = document.serialize();
    const gesture = new DesignGeometrySession(document, {rectangles: {action: bounds(document, 'action')}});
    gesture.update({x: 500.125, y: -75.25});
    gesture[finish]();
    assert.equal(document.serialize(), before);
    assert.equal(document.undoStack.length, 0);
    assert.throws(() => gesture.commit(), {code: 'SFD_GESTURE_ENDED'});
  }
});

test('stale gestures reject without overwriting an independent property edit', () => {
  const document = fixture();
  const gesture = new DesignGeometrySession(document, {rectangles: {action: bounds(document, 'action')}});
  gesture.update({x: 20, y: 0});
  document.setProperty('Content', 'changed', ['action']);
  const expected = document.serialize();
  assert.throws(() => gesture.commit(), /changed|revision/i);
  assert.equal(document.serialize(), expected);
});

test('repeated keyboard nudges and resizes remain one multi-selection transaction', () => {
  const document = fixture();
  const gesture = new DesignGeometrySession(document, {rectangles: {
    action: bounds(document, 'action'), caption: bounds(document, 'caption')
  }});
  for (let repeat = 0; repeat < 30; repeat++) gesture.nudge({x: 8, y: -1});
  gesture.commit();
  assert.equal(document.undoStack.length, 1);
  assert.equal(document.node('action').properties.Left, 290);
  assert.equal(document.node('caption').properties.Top, 73);
  const resize = new DesignGeometrySession(document, {rectangles: {action: bounds(document, 'action')}});
  for (let repeat = 0; repeat < 5; repeat++) resize.nudge({x: 1, y: 2}, {resize: true});
  resize.commit();
  assert.equal(document.node('action').properties.Width, 165);
  assert.equal(document.node('action').properties.Height, 50);
});

test('alignment and stable z-order each produce one undo entry for a multi-selection', () => {
  const document = fixture();
  document.select(['title', 'caption', 'action']);
  const rectangles = Object.fromEntries(document.selection.map(id => [id, bounds(document, id)]));
  arrangeDesignSelection(document, rectangles, 'left');
  assert(document.selection.every(id => document.node(id).properties.Left === 48));
  assert.equal(document.undoStack.length, 1);
  document.select(['title', 'caption']);
  reorderDesignSelection(document, 'front');
  assert.deepEqual(document.node('canvas').children, ['action', 'title', 'caption']);
  assert.equal(document.undoStack.length, 2);
  document.undo();
  assert.deepEqual(document.node('canvas').children, ['title', 'caption', 'action']);
});

test('draw creation commits drawn dimensions and insertion index without intermediate history', () => {
  const document = fixture();
  const id = createDrawnControl(document, {type: 'Button', parentId: 'canvas', index: 1,
    bounds: {Left: 31.25, Top: 87.5, Width: 123.25, Height: 41.5}});
  assert.equal(document.undoStack.length, 1);
  assert.equal(document.node('canvas').children[1], id);
  assert.deepEqual(bounds(document, id), {Left: 31.25, Top: 87.5, Width: 123.25, Height: 41.5});
  assert.throws(() => createDrawnControl(document, {type: 'Button', parentId: 'canvas', bounds: {Width: 0, Height: 3}}),
    {code: 'SFD_CREATE_EMPTY'});
  document.undo();
  assert.equal(document.node(id), undefined);
});

test('guides persist across serialization and participate in document undo', () => {
  const document = fixture();
  setUserGuide(document, {axis: 'x', position: 125.5});
  const restored = new DesignDocument(JSON.parse(document.serialize()));
  assert.deepEqual(guideSettings(restored.value).guides, [{id: 'guide-1', axis: 'x', position: 125.5}]);
  document.undo();
  assert.equal(guideSettings(document.value).guides.length, 0);
});

test('right margin anchor toggles Left/Stretch while retaining current margins and width', () => {
  const document = fixture();
  const grid = document.add('Grid', 'canvas');
  document.move('action', grid);
  document.setProperty('HorizontalAlignment', 0, ['action']);
  const edit = {id: 'action', side: 'right', bounds: {Left: 20, Top: 10, Width: 160, Height: 40},
    parentBounds: {Width: 400, Height: 200}};
  toggleDesignAnchor(document, edit);
  assert.equal(document.node('action').properties.HorizontalAlignment, 3);
  assert.equal(document.node('action').properties.Margin.Right, 220);
  assert.equal(document.node('action').properties.Width, undefined);
  toggleDesignAnchor(document, edit);
  assert.equal(document.node('action').properties.HorizontalAlignment, 0);
  assert.equal(document.node('action').properties.Width, 160);
  assert.deepEqual(designAnchors(document.node('action').properties), {left: true, right: false, top: true, bottom: true});
  resetDesignLayout(document, ['action']);
  assert.equal(document.node('action').properties.Margin, undefined);
});
