import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '@sharpforge/editor';
import {ownershipView} from './support/editor-view-ownership.js';

function fixture(t) {
  const original = new EditorModel('first\nsecond\nthird\n', {uri: 'Program.cs'});
  const editor = ownershipView(original);
  const models = new Set([original]);
  t.after(() => { editor.dispose(); for (const model of models) model.dispose(); });
  editor.selections = [{anchor: 8, active: 11}];
  editor.folding.setRanges([{startLine: 0, endLine: 2, collapsed: true}], original.lineCount);
  editor.view.scrollTo({top: 80, left: 16});
  return {original, editor, models};
}

test('ordinary model switches retain selections, folding and scroll without transferring model ownership', t => {
  const {original, editor, models} = fixture(t);
  const bookmarks = editor.bookmarks, tracking = editor.changeTracking;
  editor.setModel('Other.cs', 'other');
  models.add(editor.model);
  assert.equal(editor.models.get(original.uri), original);
  editor.setModel(original.uri, original);
  assert.deepEqual(editor.selections, [{anchor: 8, active: 11}]);
  assert.equal(editor.view.scrollTop, 80);
  assert.equal(editor.view.viewport.scrollLeft, 16);
  assert.equal(editor.folding.regions[0].collapsed, true);
  assert.equal(editor.bookmarks, bookmarks);
  assert.equal(editor.changeTracking, tracking);
  editor.dispose();
  assert.equal(editor.session.views.size, 0);
  assert.equal(editor.models.get(original.uri), original);
  assert.doesNotThrow(() => original.prepareEdits([]));
  assert.deepEqual(editor.session.foldingState.documents.get(original.uri), [{startLine: 0, endLine: 2}]);
});

test('a removed model cannot reinsert itself or overwrite folding state when its old view is disposed', t => {
  const {original, editor} = fixture(t);
  editor.saveViewState();
  editor.models.delete(original.uri);
  const currentFolds = [{startLine: 1, endLine: 2}];
  editor.session.foldingState.documents.set(original.uri, currentFolds);
  editor.dispose();
  assert.equal(editor.models.has(original.uri), false);
  assert.equal(editor.viewStates.has(original.uri), false);
  assert.equal(editor.session.foldingState.documents.get(original.uri), currentFolds);
});

test('an externally replaced model keeps its registry entry and cache when the previous view saves state', t => {
  const {original, editor, models} = fixture(t);
  editor.saveViewState();
  const replacement = new EditorModel('a\nb\nc', {uri: original.uri});
  models.add(replacement);
  editor.models.set(original.uri, replacement);
  const currentFolds = [{startLine: 0, endLine: 1}];
  editor.session.foldingState.documents.set(original.uri, currentFolds);
  editor.saveViewState();
  assert.equal(editor.models.get(original.uri), replacement);
  assert.equal(editor.viewStates.has(original.uri), false);
  assert.equal(editor.session.foldingState.documents.get(original.uri), currentFolds);
  editor.setModel(original.uri, replacement);
  assert.equal(editor.bookmarks.model, replacement);
  assert.equal(editor.changeTracking.model, replacement);
  assert.deepEqual(editor.selections, replacement.selections);
  assert.equal(editor.folding.regions.length, 0);
  assert.equal(editor.view.scrollTop, 0);
});

test('standalone explicit same-URI replacement discards state belonging to the previous model', t => {
  const {original, editor, models} = fixture(t);
  const replacement = new EditorModel('x', {uri: original.uri});
  models.add(replacement);
  editor.setModel(original.uri, replacement);
  assert.equal(editor.models.get(original.uri), replacement);
  assert.equal(editor.viewStates.has(original.uri), false);
  assert.equal(editor.bookmarks.model, replacement);
  assert.equal(editor.changeTracking.model, replacement);
  assert.deepEqual(editor.selections, replacement.selections);
  assert.equal(editor.view.viewport.scrollLeft, 0);
  editor.dispose();
  assert.equal(editor.viewStates.get(original.uri).model, replacement);
  assert.doesNotThrow(() => replacement.prepareEdits([]));
});
