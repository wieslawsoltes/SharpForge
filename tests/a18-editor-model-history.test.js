import test from 'node:test';
import assert from 'node:assert/strict';
import {UndoStack} from '@sharpforge/editor';
import {DesignerDocumentHistory} from '../apps/studio/designer-document-history.js';
import {DesignerDocumentView} from '../apps/studio/designer-document-view.js';
import {applyDesignerSourceTransaction} from '../apps/studio/designer-source-transaction.js';
import {designerHistoryBytes} from '../apps/studio/designer-history-budget.js';
import {editorModelView} from './fixtures/a18-editor-model-view.js';

function host(context, limits = {}) {
  const editor = editorModelView('earlier text', 'A.cs');
  editor.setValue('current text');
  editor.setSelections([{anchor: 2, active: 5}, {anchor: 10, active: 8}], {primaryIndex: 1});
  editor.view.scrollTo({top: 75, left: 14});
  const state = {files: [{uri: 'A.cs', text: editor.value, version: 1}], revision: 1, diskRevision: 0,
    buildDirty: false, breakpoints: {}, dirtyFiles: new Set()};
  const editors = new Map([['A.cs', editor]]);
  const applyEdits = edits => applyDesignerSourceTransaction({state, editors, edits, remapBreakpoints: (_before, _after, points) => points});
  const history = new DesignerDocumentHistory({files: () => state.files, editors, applyEdits, ...limits});
  const write = text => {
    const file = state.files[0];
    const changes = [{uri: file.uri, before: file.text, text}];
    const beforeEditors = history.capture(changes);
    applyEdits([{uri: file.uri, start: 0, end: file.text.length, newText: text, version: file.version}]);
    history.record({uri: file.uri, changes, beforeEditors, beforeAnalysis: {revision: 'before'}, afterAnalysis: {revision: 'after'}});
  };
  context.after(() => { history.dispose(); editor.dispose(); });
  return {editor, state, editors, history, write};
}

test('A18 designer undo restores public native checkpoints and multicaret view state without rewinding source versions', context => {
  const {editor, state, history, write} = host(context);
  assert.throws(() => [...editor.history], TypeError);
  const before = {undo: editor.model.undoStack.checkpoint(), selections: editor.getSelections(), primaryIndex: editor.primaryIndex};
  write('designer text');
  const after = editor.model.undoStack.checkpoint();
  const version = editor.model.version;
  editor.setSelections([{anchor: 0, active: 0}]);
  editor.view.scrollTo({top: 0, left: 0});
  assert.equal(history.undo('A.cs'), true);
  assert.equal(editor.value, 'current text');
  assert.equal(state.files[0].text, editor.value);
  assert.ok(editor.model.version > version);
  assert.deepEqual(editor.model.undoStack.checkpoint(), before.undo);
  assert.deepEqual(editor.getSelections(), before.selections);
  assert.equal(editor.primaryIndex, before.primaryIndex);
  assert.equal(editor.view.scrollTop, 75);
  assert.equal(editor.view.viewport.scrollLeft, 14);
  const undoneVersion = editor.model.version;
  assert.equal(history.undo('A.cs', true), true);
  assert.equal(editor.value, 'designer text');
  assert.ok(editor.model.version > undoneVersion);
  assert.deepEqual(editor.model.undoStack.checkpoint(), after);
  assert.equal(history.undo('A.cs'), true);
  assert.equal(editor.model.undo(), true);
  assert.equal(editor.value, 'earlier text');
});

test('A18 designer undo rejects a newer editor buffer even if delayed workspace text still matches', context => {
  const {editor, state, history, write} = host(context);
  write('designer text');
  editor.setValue('pending native callback');
  const checkpoint = editor.model.checkpoint();
  const files = structuredClone(state.files);
  assert.throws(() => history.undo('A.cs'), /changed independently/);
  assert.deepEqual(state.files, files);
  assert.equal(editor.model.snapshot(), checkpoint.buffer.snapshot);
  assert.deepEqual(editor.model.undoStack.checkpoint(), checkpoint.undo);
  assert.equal(history.past.length, 1);
  assert.equal(history.applying, false);
});

test('A18 a reopened model retains its own native history instead of adopting a closed model checkpoint', context => {
  const {state, editors, history, write} = host(context);
  write('designer text');
  const reopened = editorModelView(state.files[0].text, 'A.cs');
  context.after(() => reopened.dispose());
  editors.set('A.cs', reopened);
  assert.equal(reopened.history.length, 0);
  assert.equal(history.undo('A.cs'), true);
  assert.equal(reopened.history.length, 1);
  assert.equal(reopened.model.undo(), true);
  assert.equal(reopened.value, 'designer text');
});

test('A18 designer history accounts for retained native undo payloads inside its byte limit', context => {
  const {editor, history, write} = host(context, {maxBytes: 4000});
  editor.setValue('x'.repeat(10_000));
  editor.setValue('current text');
  write('designer text');
  assert.equal(history.past.length, 0, 'small source changes cannot hide large retained native histories');
  assert.equal(history.future.length, 0);
  assert.equal(editor.value, 'designer text');
});

test('A18 long coalesced native histories have bounded iterative accounting, including their oldest payload', () => {
  const undo = new UndoStack({clock: () => 0});
  const selections = [{anchor: 0, active: 0}];
  for (let index = 0; index < 6000; index++) {
    undo.record({changes: [{start: 0, end: 0, text: index === 0 ? 'x'.repeat(20_000) : 'x'}],
      inverseEdits: [{start: 0, end: 1, text: ''}]}, {beforeSelections: selections, afterSelections: selections, command: 'typing'});
  }
  assert.equal(undo.depth, 1);
  const checkpoint = undo.checkpoint();
  assert.ok(designerHistoryBytes(checkpoint, 20_000_000) > 40_000);
  assert.ok(designerHistoryBytes(checkpoint, 1024) > 1024);
});

test('A18 designer history retains at most the configured entry count across undo and redo', context => {
  const {history, write} = host(context, {maxEntries: 2});
  for (let index = 0; index < 4; index++) write('edit ' + index);
  assert.equal(history.past.length, 2);
  assert.equal(history.undo('A.cs'), true);
  assert.equal(history.undo('A.cs'), true);
  assert.equal(history.undo('A.cs'), false);
  assert.equal(history.future.length, 2);
  assert.equal(history.undo('A.cs', true), true);
  assert.equal(history.past.length + history.future.length, 2);
});

test('A18 Design/Code visibility preserves multiple carets, primary direction and logical virtual scroll', context => {
  const {editor} = host(context);
  const owner = {editor, codePane: {hidden: false}};
  const before = editor.getSelections();
  DesignerDocumentView.prototype.captureEditorViewport.call(owner, false);
  owner.codePane.hidden = true;
  editor.setSelections([{anchor: 0, active: 0}]);
  editor.view.scrollTo({top: 0, left: 0});
  DesignerDocumentView.prototype.captureEditorViewport.call(owner, true);
  owner.codePane.hidden = false;
  DesignerDocumentView.prototype.restoreEditorViewport.call(owner);
  assert.deepEqual(editor.getSelections(), before);
  assert.equal(editor.primaryIndex, 1);
  assert.equal(editor.view.scrollTop, 75);
  assert.equal(editor.view.viewport.scrollLeft, 14);
  assert.equal(owner.pendingEditorViewport, null);
});

test('A18 returning from Design preserves the latest model-transformed carets after hidden source edits', context => {
  const {editor} = host(context);
  const owner = {editor, codePane: {hidden: false}};
  DesignerDocumentView.prototype.captureEditorViewport.call(owner, false);
  owner.codePane.hidden = true;
  editor.model.applyEdits([{start: 0, end: 0, text: 'prefix '}]);
  const current = editor.getSelections();
  DesignerDocumentView.prototype.captureEditorViewport.call(owner, true);
  owner.codePane.hidden = false;
  DesignerDocumentView.prototype.restoreEditorViewport.call(owner);
  assert.deepEqual(editor.getSelections(), current);
  assert.equal(editor.primaryIndex, 1);
  assert.equal(editor.view.scrollTop, 75);
});
