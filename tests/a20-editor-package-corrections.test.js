// Editor-only cases from integration snapshot 4afa8284; the three Studio configuration cases remain in the dependent workbench scope.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CodeEditor, EditorModel, editorOptions, LineLayout, DocumentLayout, FoldingModel, FoldingProvider,
  SyntaxHighlightIndex, BookmarkModel, ChangeTracking, fallbackFolding, LargeFilePolicy,
  advancedCommands} from '@sharpforge/editor';
import {EditorPresentation} from '../packages/editor/src/core/presentation.js';
import {EditorEditing} from '../packages/editor/src/core/editing.js';

function editorFixture(text, uri = 'src/Program.cs') {
  const model = new EditorModel(text, {uri});
  const attributes = new Map();
  const editor = {
    model, uri, optionDefaults: {}, endOfLineExplicit: false, primaryIndex: 0, optionsRevision: 0,
    options: editorOptions({endOfLine: model.metadata.dominantEol}),
    input: {readOnly: false, setAttribute(name, value) { attributes.set(name, value); }},
    element: {classList: {toggle() {}}}, largeFile: {active: false, update() {}},
    view: {layout: {reset() {}, invalidate() {}}, scroll: {invalidate() {}}, configure() {}, reveal() {}},
    zoomControl: {update() {}}, bracketColors: {update() {}}, caretOffset: 0, cursor() {}, sync() {},
    decorationOwners: new Map(),
    inputController: {composition: {cancel() {}}}, keymapAdapter: {setReadOnly() {}},
    getSelections() { return this.model.selections; },
    applyEdits(edits, options) { return this.model.applyEdits(edits, options); }
  };
  const readOnly = Object.getOwnPropertyDescriptor(CodeEditor.prototype, 'readOnly').get;
  Object.defineProperty(editor, 'readOnly', {get() { return readOnly.call(this); }});
  editor.presentation = new EditorPresentation(editor);
  editor.applyEditorConfig = (files, options) => editor.presentation.applyEditorConfig(files, options);
  editor.readOnlySubscription = model.onDidChangeReadOnly(() => editor.presentation.syncReadOnly());
  editor.presentation.syncReadOnly();
  return {editor, model, attributes};
}

test('A20 shared-model locks update each pane, reject prepared edits, and preserve rollback and history', () => {
  const first = editorFixture('first');
  const second = editorFixture('unused');
  second.editor.readOnlySubscription();
  second.editor.model = first.model;
  second.editor.readOnlySubscription = first.model.onDidChangeReadOnly(() => second.editor.presentation.syncReadOnly());
  first.model.applyEdits([{start: 0, end: 5, text: 'changed'}], {undoStop: true});
  const prepared = first.model.prepareEdits([{start: 0, end: 0, text: '!'}]);
  const checkpoint = first.model.checkpoint();
  const version = first.model.version;
  first.editor.presentation.setReadOnly(true);
  for (const view of [first, second]) {
    assert.equal(view.editor.input.readOnly, true);
    assert.equal(view.attributes.get('aria-readonly'), 'true');
    assert.equal(CodeEditor.prototype.applyEdits.call(view.editor, [{start: 0, end: 0, text: '!'}]), false);
  }
  assert.throws(() => first.model.prepareEdits([{start: 0, end: 0, text: '!'}]), {code: 'SFEDITOR_READ_ONLY'});
  assert.throws(() => first.model.commitPrepared(prepared), {code: 'SFEDITOR_READ_ONLY'});
  assert.equal(first.model.undo(), false);
  assert.equal(first.model.redo(), false);
  first.model.restoreCheckpoint(checkpoint);
  assert.equal(first.model.readOnly, true);
  assert.equal(first.model.version, version);
  assert.equal(first.model.getText(), 'changed');
  first.model.readOnly = false;
  assert.equal(second.editor.input.readOnly, false);
  assert.equal(first.model.undo(), true);
  assert.equal(first.model.getText(), 'first');
  first.editor.readOnlySubscription();
  second.editor.readOnlySubscription();
  first.model.dispose();
  second.model.dispose();
});

test('A20 read-only construction and subscription disposal do not change document revisions', () => {
  const model = new EditorModel('locked', {readOnly: true});
  const changes = [];
  const dispose = model.onDidChangeReadOnly(value => changes.push(value));
  const version = model.version;
  assert.throws(() => model.setValue('new'), {code: 'SFEDITOR_READ_ONLY'});
  assert.equal(model.setReadOnly(true), false);
  model.setReadOnly(false);
  model.setReadOnly(false);
  dispose();
  model.setReadOnly(true);
  assert.deepEqual(changes, [false]);
  assert.equal(model.version, version);
  assert.equal(model.undoStack.depth, 0);
  model.dispose();
  assert.throws(() => model.setReadOnly(false), /disposed/);
});

test('A20 same-line offscreen edits reconcile wrap counts and zone mapping without visiting the line', () => {
  const {editor, model} = editorFixture('short\n'.repeat(600));
  editor.options.wordWrap = true;
  editor.options.maxRenderedLineCharacters = 1024;
  editor.folding = new FoldingModel();
  editor.viewZones = new Map([['lens', [{afterLine: 400, height: 44}]]]);
  editor.view.viewport = {scrollLeft: 0};
  editor.padding = 14;
  const layout = new DocumentLayout(editor, new LineLayout());
  layout.configure(80);
  while (layout.wrapRanges.length) layout.flushWrap();
  const oldRows = layout.map.rowCount;
  const start = model.getLineStart(400);
  const change = model.applyEdits([{start, end: start + 5, text: 'a long offscreen wrapped replacement'}]);
  layout.invalidate(change);
  assert.equal(layout.cache.has(400), false);
  assert.equal(layout.map.rowCount, oldRows);
  layout.flushWrap();
  assert(layout.map.counts[400] > 3);
  assert.equal(layout.map.rowAt(401), 400 + layout.map.counts[400]);
  const shorter = model.applyEdits([{start, end: model.getLineEnd(400), text: 'x'}]);
  layout.invalidate(shorter);
  layout.flushWrap();
  assert.equal(layout.map.counts[400], 3);
  assert.equal(layout.map.rowCount, oldRows);
  layout.measureWrap();
  layout.dispose();
  assert.equal(layout.wrapRanges.length, 0);
  model.dispose();
});

test('A20 wrap measurement stays chunked after a large same-line-count replacement', () => {
  const {editor} = editorFixture('x\n'.repeat(400));
  editor.folding = new FoldingModel();
  editor.viewZones = new Map();
  editor.view.viewport = {scrollLeft: 0};
  editor.options.wordWrap = true;
  const layout = new DocumentLayout(editor, new LineLayout());
  layout.measureWrap();
  layout.flushWrap();
  assert.equal(layout.wrapRanges[0].start, 128);
  assert.equal(layout.cache.size, 128);
  layout.dispose();
  editor.model.dispose();
});

test('A20 deleting a brace or region marker on one line refreshes the actual folding provider', async () => {
  for (const [text, marker] of [['class C {\nint x;\n}', '{'], ['#region Test\nsource\n#endregion', '#']]) {
    const {editor, model} = editorFixture(text);
    Object.assign(editor, {
      selections: model.selections, decorationRevision: 0, callbacks: {splitChild: true},
      highlightIndex: new SyntaxHighlightIndex(model.snapshot()), folding: new FoldingModel(),
      bookmarks: new BookmarkModel(model), changeTracking: new ChangeTracking(model),
      publishChange() {}, notifyContributions() {},
      services: {supports: () => true, invoke: async () => fallbackFolding(model, editor.highlightIndex)}
    });
    editor.foldingProvider = new FoldingProvider(editor);
    model.onDidChange(change => CodeEditor.prototype.modelChanged.call(editor, change));
    await editor.foldingProvider.refresh();
    assert(editor.folding.regions.length > 0);
    const offset = text.indexOf(marker);
    model.applyEdits([{start: offset, end: offset + 1, text: ''}]);
    assert(editor.foldingProvider.timer);
    await editor.foldingProvider.refresh();
    assert.equal(editor.folding.regions.length, 0);
    editor.foldingProvider.dispose();
    editor.highlightIndex.dispose();
    model.dispose();
  }
});

test('A20 multi-caret deletion retains blocked carets and merges overlapping word deletions in one undo step', () => {
  const {editor, model} = editorFixture('abc def');
  const editing = new EditorEditing(editor);
  model.setSelections([{anchor: 0, active: 0}, {anchor: 3, active: 3}], {primaryIndex: 1});
  editor.primaryIndex = 1;
  editing.deleteText(-1);
  assert.equal(model.getText(), 'ab def');
  assert.deepEqual(model.selections.map(selection => selection.active), [0, 2]);
  assert.equal(model.primaryIndex, 1);
  model.undo();
  assert.equal(model.getText(), 'abc def');
  assert.deepEqual(model.selections.map(selection => selection.active), [0, 3]);
  model.setSelections([{anchor: 1, active: 1}, {anchor: 2, active: 2}]);
  editor.primaryIndex = 0;
  editing.deleteText(-1, {word: true});
  assert.equal(model.getText(), 'c def');
  assert.equal(model.selections.length, 1);
  model.undo();
  assert.equal(model.getText(), 'abc def');
});

test('A20 invalid load chunk sizes reject before reading or replacing the document', async () => {
  const {editor, model} = editorFixture('original');
  const policy = new LargeFilePolicy(editor);
  for (const chunkSize of [0, -1, 0.5, Infinity, 8 * 1024 * 1024 + 1]) {
    await assert.rejects(policy.load(new Blob(['new']), {chunkSize}), RangeError);
    assert.equal(editor.model, model);
    assert.equal(model.getText(), 'original');
  }
  policy.dispose();
});

test('A20 overlapping whole-line expansions transform every selected line once', () => {
  const {editor, model} = editorFixture('z\ncba\na');
  model.setSelections([{anchor: 0, active: 3}, {anchor: 4, active: 7}]);
  advancedCommands(editor)['edit.sortLines']();
  assert.equal(model.getText(), 'a\ncba\nz');
  assert.equal(model.undoStack.depth, 1);
  model.undo();
  assert.equal(model.getText(), 'z\ncba\na');
  advancedCommands(editor)['edit.joinLines']();
  assert.equal(model.getText(), 'z cba a');
  assert.equal(model.undoStack.depth, 1);
  model.undo();
  assert.equal(model.getText(), 'z\ncba\na');
});
