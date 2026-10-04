import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel, ClipboardRing, CompositionController, HiddenInputController, SyntaxHighlightIndex, editorOptions} from '@sharpforge/editor';
import {modelForView} from '../packages/editor/src/view/model-adapter.js';
import {EditorPresentation} from '../packages/editor/src/core/presentation.js';

function fixture(text, selections) {
  const model = new EditorModel(text, {selections});
  const editor = {model, options: editorOptions(), primaryIndex: 0, input: {readOnly: false}, clipboardRing: new ClipboardRing(),
    getSelections() { return this.model.selections; }, setSelections(values) { this.model.setSelections(values); },
    applyEdits(edits, options) { return this.model.applyEdits(edits, options); }};
  return editor;
}

function clipboardEvent(data = new Map()) {
  return {prevented: false, preventDefault() { this.prevented = true; },
    clipboardData: {getData: key => data.get(key) ?? '', setData: (key, value) => data.set(key, value)}, data};
}

test('A20 native clipboard retains per-caret fragments, line-copy metadata and malformed payload fallback', () => {
  const editor = fixture('a\nb', [{anchor: 0, active: 1}, {anchor: 2, active: 3}]);
  const controller = {editor, element: editor.input};
  const copied = clipboardEvent();
  HiddenInputController.prototype.copy.call(controller, copied, false);
  assert.equal(copied.data.get('text/plain'), 'a\nb');
  editor.model = new EditorModel('x\ny', {selections: [{anchor: 0, active: 1}, {anchor: 2, active: 3}]});
  HiddenInputController.prototype.paste.call(controller, copied);
  assert.equal(editor.model.getText(), 'a\nb');
  assert.equal(editor.model.undoStack.depth, 1);
  const invalid = clipboardEvent(new Map([['text/plain', 'Z'], ['application/x-sharpforge-selections+json', '{bad']]));
  HiddenInputController.prototype.paste.call(controller, invalid);
  assert.equal(editor.model.getText(), 'aZ\nbZ');
  editor.model = new EditorModel('line\nnext');
  const line = clipboardEvent();
  HiddenInputController.prototype.copy.call(controller, line, false);
  assert.equal(line.data.get('text/plain'), 'line\n');
  HiddenInputController.prototype.paste.call(controller, line);
  assert.equal(editor.model.getText(), 'line\nline\nnext');
});

test('A20 view model adapter follows document switches and keeps view selections independent', () => {
  const editor = fixture('first');
  let viewSelections = [{anchor: 2, active: 2}];
  editor.getSelections = () => viewSelections;
  editor.setSelections = selections => { viewSelections = selections; };
  const adapter = modelForView(editor);
  assert.equal(adapter.getText(), 'first');
  assert.equal(adapter.primarySelection.active, 2);
  adapter.setSelections([{anchor: 4, active: 4}]);
  assert.equal(editor.model.selections[0].active, 0);
  editor.model = new EditorModel('second');
  assert.equal(adapter.getText(), 'second');
  assert.equal(adapter.length, 6);
});

test('A20 synthetic composition commits once, cancels safely and cannot cross document identity', () => {
  const editor = fixture('a😀b');
  const overlay = () => ({style: {}, hidden: true, setAttribute() {}, remove() {}});
  editor.element = {ownerDocument: {createElement: overlay}, append() {}};
  editor.view = {coordsAt: () => ({left: 10, top: 22, height: 22})};
  editor.closeCompletion = () => {};
  Object.defineProperties(editor.input, {
    selectionStart: {get: () => Math.min(editor.model.selections[0].anchor, editor.model.selections[0].active)},
    selectionEnd: {get: () => Math.max(editor.model.selections[0].anchor, editor.model.selections[0].active)}
  });
  const composition = new CompositionController(editor, {synchronize() {}});
  editor.setSelections([{anchor: 1, active: 3}]);
  composition.start();
  composition.update('に');
  composition.update('日本');
  assert.equal(editor.model.getText(), 'a😀b');
  assert.equal(editor.model.undoStack.depth, 0);
  composition.end('日本');
  assert.equal(editor.model.getText(), 'a日本b');
  assert.equal(editor.model.undoStack.depth, 1);
  composition.end('日本');
  assert.equal(editor.model.getText(), 'a日本b');
  composition.start();
  composition.update('文');
  composition.end('');
  assert.equal(editor.model.getText(), 'a日本b');
  composition.start();
  editor.model = new EditorModel('other');
  composition.end('文');
  assert.equal(editor.model.getText(), 'other');
  editor.readOnly = true;
  composition.start();
  assert.equal(composition.active, false);
  composition.dispose();
});

test('A20 rename preview refreshes token/layout caches without publishing or recording edits', () => {
  const model = new EditorModel('int value;');
  const checkpoint = model.checkpoint();
  const events = [];
  model.onDidChange(event => events.push(event));
  const highlighted = new SyntaxHighlightIndex(model.snapshot());
  let resets = 0;
  const editor = {model, highlightIndex: highlighted, disposed: false, decorationRevision: 0,
    view: {layout: {reset() { resets++; }}, scroll: {reset() { resets++; }}, render() { resets++; }}, accessibility: {update() {}}};
  const presentation = new EditorPresentation(editor);
  const prepared = model.prepareEdits([{start: 4, end: 9, text: 'renamed'}]);
  model.commitPrepared(prepared, {notify: false});
  presentation.refreshPreview();
  assert.equal(highlighted.source.getText(), 'int renamed;');
  assert.equal(resets, 3);
  assert.equal(events.length, 0);
  model.restoreCheckpoint(checkpoint);
  presentation.refreshPreview();
  assert.equal(highlighted.source.getText(), 'int value;');
  assert.equal(model.undoStack.depth, 0);
  highlighted.dispose();
});
