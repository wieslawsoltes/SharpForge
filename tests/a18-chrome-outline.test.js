import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, createDesign, generateDesignCode} from '@sharpforge/designer';
import {DesignerOutlineState, moveOutlineNodes} from '../apps/studio/designer-outline-state.js';
import {DesignerOutline} from '../apps/studio/designer-outline.js';

const fixture = () => new DesignDocument(createDesign('Outline'));

test('hidden and locked state is inherited and never changes generated source or design history', () => {
  const document = fixture();
  const state = new DesignerOutlineState(document);
  const source = generateDesignCode(document.value);
  const saved = document.serialize();
  state.toggle('canvas', 'hidden');
  state.toggle('canvas', 'locked');
  assert.equal(state.isVisible('action'), false);
  assert.equal(state.isLocked('action'), true);
  assert.deepEqual(state.filterSelection(['window', 'title', 'action']), ['window']);
  assert.equal(document.serialize(), saved);
  assert.equal(generateDesignCode(document.value), source);
  assert.equal(document.undoStack.length, 0);
  state.toggle('canvas', 'hidden');
  state.toggle('canvas', 'locked');
  assert.equal(state.isVisible('action'), true);
  assert.equal(state.isLocked('action'), false);
});

test('outline state is document-local and removes deleted node flags on bind', () => {
  const first = fixture();
  const second = fixture();
  const a = new DesignerOutlineState(first);
  const b = new DesignerOutlineState(second);
  a.toggle('action', 'locked');
  assert.equal(b.isLocked('action'), false);
  first.remove(['action']);
  a.bind(first);
  assert.equal(a.locked.size, 0);
  assert.throws(() => a.toggle('missing', 'locked'), /no longer exists/);
  assert.throws(() => a.toggle('window', 'hidden'), /remain visible/);
});

test('before and after insertion preserve sibling order with one undo transaction', () => {
  const document = fixture();
  const state = new DesignerOutlineState(document);
  const original = [...document.node('canvas').children];
  moveOutlineNodes(document, state, ['action'], 'title', 'before');
  assert.deepEqual(document.node('canvas').children, ['action', 'title', 'caption']);
  assert.equal(document.undoStack.length, 1);
  document.undo();
  assert.deepEqual(document.node('canvas').children, original);
  moveOutlineNodes(document, state, ['title'], 'action', 'after');
  assert.deepEqual(document.node('canvas').children, ['caption', 'action', 'title']);
});

test('locked destinations, cycles and content overfill are rejected atomically', () => {
  const document = fixture();
  const state = new DesignerOutlineState(document);
  const before = document.serialize();
  state.toggle('action', 'locked');
  assert.throws(() => moveOutlineNodes(document, state, ['action'], 'title', 'before'), /Unlock/);
  assert.throws(() => moveOutlineNodes(document, state, ['title'], 'action', 'inside'), /Unlock/);
  state.toggle('action', 'locked');
  assert.throws(() => moveOutlineNodes(document, state, ['canvas'], 'action'), /ancestor/);
  assert.throws(() => moveOutlineNodes(document, state, ['title'], 'window'), /contain/);
  assert.throws(() => moveOutlineNodes(document, state, ['window'], 'title'), /root/);
  assert.throws(() => moveOutlineNodes(document, state, ['title', 'title'], 'action'), /invalid/);
  assert.equal(document.serialize(), before);
  assert.equal(document.undoStack.length, 0);
});

test('dragging parent and descendant moves only the root of that selection', () => {
  const document = fixture();
  const panel = document.add('StackPanel', 'canvas');
  document.move('title', panel);
  const state = new DesignerOutlineState(document);
  const before = document.undoStack.length;
  moveOutlineNodes(document, state, [panel, 'title'], 'caption', 'before');
  assert.equal(document.parent('title').id, panel);
  assert.equal(document.undoStack.length, before + 1);
  assert.deepEqual(document.selection, [panel]);
});

test('outline visibility binds a replaced document before any surface selection query', () => {
  const view = {document: fixture()};
  const outline = new DesignerOutline(view);
  outline.state.toggle('action', 'locked');
  const replacement = fixture();
  replacement.remove(['action']);
  const added = replacement.add('Button', 'canvas');
  view.document = replacement;
  assert.equal(outline.isVisible(added), true);
  assert.equal(outline.isLocked('action'), false);
  assert.deepEqual(outline.filterSelection(['action', added]), [added]);
});

test('invalid or locked outline drops cannot fall through to the base tree reparenting handler', () => {
  const document = fixture();
  let callbacks = 0;
  const outline = new DesignerOutline({document, safe: action => { callbacks++; return action(); }});
  outline.state.toggle('action', 'locked');
  let stopped = 0;
  let prevented = 0;
  const event = {
    target: {closest: () => ({dataset: {treeId: 'action'}})},
    dataTransfer: {types: ['application/x-sharpforge-tree'], dropEffect: 'move'},
    stopImmediatePropagation: () => stopped++, preventDefault: () => prevented++
  };
  outline.dragOver(event);
  assert.equal(stopped, 1);
  assert.equal(event.dataTransfer.dropEffect, 'none');
  assert.equal(outline.dropTarget, null);
  outline.drop(event);
  assert.equal(stopped, 2);
  assert.equal(prevented, 1);
  assert.equal(callbacks, 0);
  assert.equal(document.undoStack.length, 0);
});
