import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel, EditorModelWorkspace, prepareWorkspaceEdit, commitWorkspaceEdit, editorOptions} from '@sharpforge/editor';
import {RenamePreview} from '../packages/editor/src/features/rename-preview.js';
import {commitEditorPrepared} from '../packages/editor/src/core/edit-transaction.js';
import {prepareEditorSave} from '../packages/editor/src/core/save-preparation.js';
import {editorRevision, sameRevision} from '../packages/editor/src/services/async-guard.js';
import {TextBuffer} from '@sharpforge/text';

function view(model) {
  return {model, uri: model.uri, get value() { return model.value; },
    selections: model.selections, primaryIndex: 0, options: editorOptions(), optionsRevision: 0, endOfLineExplicit: false,
    notifyContributions() {}, refreshPreview() {}};
}

test('preview has a visual root but publishes original source without undo entries or change events', () => {
  const model = new EditorModel('name\r\nname', {uri: 'A.cs'});
  model.setSelections([{anchor: 2, active: 2}]);
  model.scroll = {top: 40, left: 3};
  const editor = view(model), source = model.snapshot(), revision = editorRevision(editor);
  const changes = [];
  model.onDidChange(change => changes.push(change));
  const preview = new RenamePreview(editor);
  preview.show([{start: 0, end: 4, text: 'longerName'}]);
  assert.equal(model.value, 'longerName\r\nname');
  assert.equal(model.publishedSnapshot(), source);
  assert.equal(editorRevision(editor).version, source.version);
  assert.equal(sameRevision(revision, editorRevision(editor)), false);
  assert.equal(model.undoStack.depth, 0);
  assert.equal(model.isDirty, false);
  assert.deepEqual(changes, []);
  preview.release();
  preview.release();
  assert.equal(model.snapshot(), source);
  assert.equal(model.publishedSnapshot(), source);
  assert.equal(model.primarySelection.active, 2);
  assert.deepEqual(model.scroll, {top: 40, left: 3});
  assert.equal(model.previewActive, false);
  assert.throws(() => preview.show([]), /released/);
  model.dispose();
});

test('non-owner edits, history, checkpoint restores and competing previews reject without mutation', () => {
  const model = new EditorModel('name');
  model.applyEdits([{start: 4, end: 4, text: '!'}]);
  const checkpoint = model.checkpoint();
  const lease = model.beginPreview();
  const prepared = model.prepareEdits([{start: 0, end: 4, text: 'temporary'}], {previewLease: lease});
  model.commitPrepared(prepared, {notify: false});
  for (const action of [() => model.applyEdits([{start: 0, end: 0, text: 'x'}]),
    () => model.setValue('external'), () => model.undo(), () => model.redo(),
    () => model.restoreCheckpoint(checkpoint), () => model.beginPreview(), () => model.emitChange(prepared)]) {
    assert.throws(action, {code: 'SFEDITOR_PREVIEW_ACTIVE'});
    assert.equal(model.value, 'temporary!');
    assert.equal(model.publishedSnapshot().text, 'name!');
  }
  assert.throws(() => model.endPreview({}), {code: 'SFEDITOR_PREVIEW_ACTIVE'});
  assert.equal(model.previewActive, true);
  model.endPreview(lease);
  assert.throws(() => model.emitChange(prepared), {code: 'SFEDITOR_PREVIEW_ACTIVE'});
  assert.equal(model.undo(), true);
  assert.equal(model.value, 'name');
  model.dispose();
});

test('preview ownership epochs reject old prepared commits and editor rebinding after exact-root restoration', () => {
  const model = new EditorModel('name');
  const editor = view(model);
  const before = model.snapshot(), checkpoint = model.checkpoint();
  const prepared = model.prepareEdits([{start: 0, end: 4, text: 'old'}]);
  const lease = model.beginPreview();
  model.endPreview(lease);
  assert.equal(model.snapshot(), before);
  for (const action of [() => model.commitPrepared(prepared), () => commitEditorPrepared(editor, prepared),
    () => model.restoreCheckpoint(checkpoint)]) assert.throws(action, {code: 'SFEDITOR_PREVIEW_STALE'});
  assert.equal(model.value, 'name');
  model.dispose();
});

test('async preparation cannot cross a preview ownership cycle even when root and version are restored', async () => {
  const model = new EditorModel('name');
  const before = model.snapshot();
  const pending = model.prepareEditsAsync([{start: 0, end: 4, text: 'old'}]);
  const lease = model.beginPreview();
  model.endPreview(lease);
  await assert.rejects(pending, {code: 'SFEDITOR_PREVIEW_STALE'});
  assert.equal(model.snapshot(), before);
  model.dispose();
});

test('saved markers survive preview cancellation and no-op save captures the committed root', () => {
  const model = new EditorModel('name');
  model.applyEdits([{start: 4, end: 4, text: ' '}]);
  const editor = view(model), source = model.snapshot();
  const preview = new RenamePreview(editor);
  preview.show([{start: 0, end: 4, text: 'preview'}]);
  assert.equal(prepareEditorSave(editor), source);
  editor.options = editorOptions({trimTrailingWhitespace: true});
  assert.throws(() => prepareEditorSave(editor), {code: 'SFEDITOR_SAVE_STALE'});
  model.markSaved();
  preview.dispose();
  assert.equal(model.snapshot(), source);
  assert.equal(model.isDirty, false);
  assert.equal(model.undoStack.depth, 1);
  assert.equal(model.undo(), true);
  assert.equal(model.isDirty, true);
  model.dispose();
});

test('ordinary atomic silent commits publish every root before the first model notification', () => {
  const models = new Map([['A.cs', new EditorModel('a', {uri: 'A.cs'})], ['B.cs', new EditorModel('b', {uri: 'B.cs'})]]);
  const workspace = new EditorModelWorkspace(models);
  const observed = [];
  for (const model of models.values()) model.onDidChange(() => observed.push(workspace.listDocuments().map(record => record.text)));
  const plan = prepareWorkspaceEdit(workspace, [
    {uri: 'A.cs', version: 1, start: 0, end: 1, newText: 'A'},
    {uri: 'B.cs', version: 1, start: 0, end: 1, newText: 'B'}
  ]);
  commitWorkspaceEdit(workspace, plan);
  assert.deepEqual(observed, [['A', 'B'], ['A', 'B']]);
  for (const model of models.values()) model.dispose();
});

test('disposal restores the published source and invalidates delayed preview capabilities', () => {
  const model = new EditorModel('name');
  const source = model.snapshot(), preview = new RenamePreview(view(model));
  preview.show([{start: 0, end: 4, text: 'preview'}]);
  model.dispose();
  assert.equal(model.publishedSnapshot(), source);
  assert.equal(model.previewActive, false);
  assert.doesNotThrow(() => preview.dispose());
  assert.throws(() => preview.show([]), /released/);
});

test('a low-level buffer mutation invalidates publication ownership without restoring over external text', () => {
  const model = new EditorModel('name');
  const preview = new RenamePreview(view(model));
  preview.show([{start: 0, end: 4, text: 'preview'}]);
  model.buffer.applyEdits([{start: 0, end: model.length, text: 'external'}]);
  const source = model.snapshot();
  assert.throws(() => model.publishedSnapshot(), {code: 'SFEDITOR_PREVIEW_STALE'});
  assert.equal(model.previewActive, false);
  assert.equal(model.snapshot(), source);
  preview.dispose();
  assert.equal(model.value, 'external');
  model.dispose();
});

test('a borrowed buffer remains externally owned and stale preview disposal preserves its advanced root', () => {
  const buffer = new TextBuffer('name');
  const model = new EditorModel('', {buffer});
  const preview = new RenamePreview(view(model));
  preview.show([{start: 0, end: 4, text: 'preview'}]);
  buffer.applyEdits([{start: 0, end: buffer.length, text: 'external'}]);
  const external = buffer.snapshot();
  assert.throws(() => model.dispose(), {code: 'SFEDITOR_PREVIEW_STALE'});
  assert.equal(buffer.snapshot(), external);
  assert.equal(model.previewActive, false);
  preview.dispose();
  assert.equal(buffer.text, 'external');
  assert.doesNotThrow(() => buffer.insert(buffer.length, '!'));
  buffer.dispose();
});

test('the preview owner cannot prepare a write over an independently advanced buffer', () => {
  const model = new EditorModel('name');
  const lease = model.beginPreview();
  model.buffer.insert(4, '!');
  const external = model.snapshot();
  assert.throws(() => model.prepareEdits([{start: 0, end: 4, text: 'preview'}], {previewLease: lease}),
    {code: 'SFEDITOR_PREVIEW_STALE'});
  assert.equal(model.previewActive, false);
  assert.equal(model.endPreview(lease), false);
  assert.equal(model.snapshot(), external);
  model.dispose();
});

test('committed notification ownership survives preview acquisition but cannot be forged or replayed', () => {
  const model = new EditorModel('name');
  const prepared = model.prepareEdits([{start: 4, end: 4, text: '!'}]);
  assert.throws(() => model.emitChange(prepared), {code: 'SFEDITOR_PREVIEW_ACTIVE'});
  model.commitPrepared(prepared, {notify: false});
  const lease = model.beginPreview();
  const changes = [];
  model.onDidChange(change => changes.push(change.after.text));
  model.emitChange(prepared);
  assert.deepEqual(changes, ['name!']);
  assert.throws(() => model.emitChange(prepared), {code: 'SFEDITOR_PREVIEW_ACTIVE'});
  model.endPreview(lease);
  model.dispose();
});

test('preview restoration repaints every live view of its model and leaves different documents untouched', () => {
  const model = new EditorModel('name');
  const other = new EditorModel('other');
  const painted = [];
  const owner = {...view(model), refreshPreview: () => painted.push('owner')};
  const secondary = {...view(model), refreshPreview: () => painted.push('secondary')};
  const unrelated = {...view(other), refreshPreview: () => painted.push('unrelated')};
  const disposed = {...view(model), disposed: true, refreshPreview: () => painted.push('disposed')};
  owner.session = {views: new Set([owner, secondary, unrelated, disposed])};
  const preview = new RenamePreview(owner);
  preview.show([{start: 0, end: 4, text: 'temporary'}]);
  painted.length = 0;
  preview.release();
  assert.deepEqual(painted, ['owner', 'secondary']);
  model.dispose();
  other.dispose();
});
