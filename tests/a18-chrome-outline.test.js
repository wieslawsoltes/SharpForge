import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, createDesign, generateDesignCode} from '@sharpforge/designer';
import {DesignerOutlineState, moveOutlineNodes} from '../apps/studio/designer-outline-state.js';

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
