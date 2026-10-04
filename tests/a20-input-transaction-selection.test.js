import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '@sharpforge/editor';
import {DocumentService} from '../apps/studio/workbench/documents.js';
import {inputView, restoreInputFocus} from './support/a20-input-view.js';

const selections = editor => editor.getSelections().map(({anchor, active}) => [anchor, active]);

function fixture(text) {
  const documents = new DocumentService({records: [{uri: 'Program.cs', text, version: 1}],
    createModel: record => new EditorModel(record.text, {uri: record.uri})});
  const model = documents.models.get('Program.cs');
  const views = [];
  return {documents, model, views,
    view(value, onEdit) { const editor = inputView(model, value, onEdit); views.push(editor); return editor; },
    dispose() { for (const editor of views) editor.dispose(); documents.dispose(); }
  };
}

test('owner-first shrinking edits preserve the committed caret through real input refocus and selection restore', () => {
  const state = fixture('x'.repeat(5120));
  const order = [];
  const editor = state.view([{anchor: 0, active: 5120}], () => order.push('view'));
  const observed = [];
  const remove = state.documents.subscribe(event => {
    if (event.type !== 'changed') return;
    order.push('owner');
    observed.push({selection: restoreInputFocus(editor), source: editor.inputController.context});
  });
  try {
    assert.doesNotThrow(() => editor.applyEdits([{start: 0, end: 5120, text: 'short'}],
      {selections: [{anchor: 5, active: 5}], source: 'typing'}));
    assert.deepEqual(observed, [{selection: [5, 5], source: 'short'}]);
    assert.deepEqual(selections(editor), [[5, 5]]);
    assert.deepEqual(order, ['owner', 'view'], 'Public model notification order stays unchanged');
    assert.equal(state.documents.get('Program.cs').text, 'short');
    assert.throws(() => state.model.getText(4096, 5), RangeError, 'Source access remains strict');
  } finally { remove(); state.dispose(); }
});

test('an independent shared view transforms before owner refocus and does not transform twice', () => {
  const state = fixture('abcdef');
  const editor = state.view([{anchor: 0, active: 0}]);
  const independent = state.view([{anchor: 4, active: 4}]);
  const observed = [];
  const remove = state.documents.subscribe(event => {
    if (event.type === 'changed') observed.push(restoreInputFocus(independent));
  });
  try {
    editor.applyEdits([{start: 0, end: 0, text: '++'}], {selections: [{anchor: 2, active: 2}]});
    assert.deepEqual(observed, [[6, 6]]);
    assert.deepEqual(selections(independent), [[6, 6]]);
    assert.deepEqual(selections(editor), [[2, 2]]);
  } finally { remove(); state.dispose(); }
});

test('grouped undo and redo prepare independent views once before every intermediate public notification', () => {
  const state = fixture('abc');
  const editor = state.view([{anchor: 3, active: 3}]);
  const independent = state.view([{anchor: 1, active: 1}]);
  const observed = [];
  const batches = [];
  const remove = state.documents.subscribe(event => {
    if (event.type === 'changed') observed.push({length: state.model.length, selection: restoreInputFocus(independent)});
  });
  const offBuffer = state.model.buffer.onDidChange(event => { if (event.historyEvents) batches.push(event.historyEvents); });
  try {
    state.model.beginUndoGroup('two-step');
    editor.applyEdits([{start: 3, end: 3, text: 'x'.repeat(3000)}], {selections: [{anchor: 3003, active: 3003}]});
    editor.applyEdits([{start: 0, end: 3002, text: ''}], {selections: [{anchor: 1, active: 1}]});
    state.model.endUndoGroup();
    observed.length = 0;
    editor.undo();
    assert.equal(state.model.text, 'abc');
    assert.deepEqual(observed, [{length: 3, selection: [3, 3]}, {length: 3, selection: [3, 3]}]);
    assert.deepEqual(selections(independent), [[3, 3]]);
    assert.deepEqual(selections(editor), [[3, 3]]);
    assert.equal(batches.length, 2);
    assert.equal(batches[0], batches[1]);
    assert.ok(Object.isFrozen(batches[0]));
    assert.equal(batches[0].length, 2);
    assert.notEqual(batches[0][0].after, state.model.snapshot(), 'Intermediate history snapshots remain distinct');
    assert.equal(batches[0][1].after, state.model.snapshot());
    observed.length = 0;
    editor.undo(true);
    assert.equal(state.model.text, 'x');
    assert.deepEqual(observed, [{length: 1, selection: [1, 1]}, {length: 1, selection: [1, 1]}]);
    assert.deepEqual(selections(independent), [[1, 1]]);
    assert.deepEqual(selections(editor), [[1, 1]]);
    assert.equal(batches.length, 4);
    assert.equal(batches[2], batches[3]);
    assert.notEqual(batches[0], batches[2]);
  } finally { offBuffer(); remove(); state.dispose(); }
});

test('nested owner edits do not reapply an already prepared outer selection transform', () => {
  const state = fixture('abcdef');
  const editor = state.view([{anchor: 4, active: 4}]);
  let nested = false;
  const observed = [];
  const remove = state.documents.subscribe(event => {
    if (event.type !== 'changed') return;
    if (!nested) {
      nested = true;
      state.model.applyEdits([{start: 6, end: 7, text: ''}]);
    }
    observed.push(restoreInputFocus(editor));
  });
  try {
    state.model.applyEdits([{start: 0, end: 0, text: '+'}]);
    assert.equal(state.model.text, '+abcde');
    assert.deepEqual(observed, [[5, 5], [5, 5]]);
    assert.deepEqual(selections(editor), [[5, 5]], 'The resumed outer model listener must not transform the view twice');
  } finally { remove(); state.dispose(); }
});

test('model rebinding and view disposal retire the early selection listener without touching the new owner', () => {
  const first = new EditorModel('first', {uri: 'First.cs'});
  const next = new EditorModel('next', {uri: 'Next.cs'});
  const editor = inputView(first, [{anchor: 1, active: 1}]);
  try {
    editor.setModel(next.uri, next);
    editor.setSelections([{anchor: 2, active: 2}]);
    first.applyEdits([{start: 0, end: 0, text: 'old'}]);
    assert.deepEqual(selections(editor), [[2, 2]]);
    next.applyEdits([{start: 0, end: 0, text: '+'}]);
    assert.deepEqual(selections(editor), [[3, 3]]);
    editor.dispose();
    next.applyEdits([{start: 0, end: 0, text: 'after disposal'}]);
    assert.deepEqual(selections(editor), [[3, 3]]);
  } finally { editor.dispose(); first.dispose(); next.dispose(); }
});

test('undo and redo preserve the initiating view when owner refocus keeps a different independent caret', () => {
  const state = fixture('abcdef');
  const editor = state.view([{anchor: 4, active: 4}]);
  const independent = state.view([{anchor: 1, active: 1}]);
  const observed = [];
  const remove = state.documents.subscribe(event => {
    if (event.type !== 'changed') return;
    restoreInputFocus(independent);
    observed.push([editor.caretOffset, independent.caretOffset]);
  });
  try {
    editor.applyEdits([{start: 6, end: 6, text: 'x'}], {selections: [{anchor: 7, active: 7}]});
    assert.equal(editor.undo(), true);
    assert.equal(editor.caretOffset, 4);
    assert.equal(independent.caretOffset, 1);
    assert.equal(editor.undo(true), true);
    assert.equal(editor.caretOffset, 7);
    assert.equal(independent.caretOffset, 1);
    assert.deepEqual(observed, [[7, 1], [4, 1], [7, 1]]);
    assert.equal(editor.undo(true), false, 'Empty history keeps the existing no-op return contract');
  } finally { remove(); state.dispose(); }
});

test('owner notifications observe the committed primary caret after explicit and merging selection changes', () => {
  const state = fixture('abcdef');
  const editor = state.view([{anchor: 0, active: 0}]);
  const independent = state.view([{anchor: 1, active: 1}, {anchor: 2, active: 2}, {anchor: 5, active: 5}]);
  independent.setSelections(independent.getSelections(), {primaryIndex: 1});
  const observed = [];
  const remove = state.documents.subscribe(event => {
    if (event.type === 'changed') observed.push([editor.primaryIndex, editor.caretOffset, independent.primaryIndex, independent.caretOffset]);
  });
  try {
    editor.applyEdits([{start: 1, end: 3, text: ''}], {
      selections: [{anchor: 0, active: 0}, {anchor: 4, active: 4}], primaryIndex: 1
    });
    assert.deepEqual(observed, [[1, 4, 0, 1]]);
    assert.deepEqual(selections(independent), [[1, 1], [3, 3]]);
    assert.equal(editor.primaryIndex, 1);
    assert.equal(independent.primaryIndex, 0);
  } finally { remove(); state.dispose(); }
});

test('owner-time rebinding retires an already-snapshotted old model callback before rendering or selection work', () => {
  const state = fixture('abcdef');
  const editor = state.view([{anchor: 4, active: 4}]);
  const next = new EditorModel('new', {uri: 'New.cs'});
  const remove = state.documents.subscribe(event => {
    if (event.type !== 'changed') return;
    editor.setModel(next.uri, next);
    editor.setSelections([{anchor: 1, active: 1}]);
  });
  try {
    state.model.applyEdits([{start: 0, end: 0, text: 'old'}]);
    assert.equal(editor.model, next);
    assert.deepEqual(selections(editor), [[1, 1]]);
    assert.equal(editor.highlightIndex.source, next.snapshot(), 'The obsolete source must not reach the rebound render index');
    next.applyEdits([{start: 0, end: 0, text: '+'}]);
    assert.deepEqual(selections(editor), [[2, 2]]);
    assert.equal(editor.highlightIndex.source, next.snapshot());
  } finally { remove(); state.dispose(); next.dispose(); }
});

test('invalid current view ranges and owner failures are still exact errors after a committed source edit', () => {
  const state = fixture('small');
  const editor = state.view([{anchor: 5, active: 5}]);
  const failure = new Error('Owner failed after commit');
  const remove = state.documents.subscribe(event => { if (event.type === 'changed') throw failure; });
  try {
    editor.selections = [{anchor: 4096, active: 4096}];
    assert.throws(() => editor.inputController.synchronize(), RangeError, 'No input range is silently clamped');
    editor.setSelections([{anchor: 5, active: 5}]);
    assert.throws(() => editor.applyEdits([{start: 0, end: 5, text: 'ok'}], {selections: [{anchor: 2, active: 2}]}),
      error => error === failure || error instanceof AggregateError && error.errors.includes(failure));
    assert.equal(state.model.text, 'ok');
    assert.deepEqual(selections(editor), [[2, 2]]);
  } finally { remove(); state.dispose(); }
});
