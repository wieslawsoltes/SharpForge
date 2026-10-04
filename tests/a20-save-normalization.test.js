import test from 'node:test';
import assert from 'node:assert/strict';
import {CodeEditor, EditorModel, editorOptions, saveTextEdits, saveTextEditsAsync} from '@sharpforge/editor';
import {EditorPresentation} from '../packages/editor/src/core/presentation.js';

function editorFor(model, options = {}, hooks = {}) {
  const notifications = [];
  const editor = {
    model, options: editorOptions(options), optionsRevision: 0, endOfLineExplicit: false,
    selections: model.selections.map(selection => ({...selection})), primaryIndex: model.primaryIndex,
    get readOnly() { return this.model.readOnly; },
    notifyContributions(name, event) { notifications.push(name); hooks[name]?.(event, this); },
    commitPrepared(prepared) { return CodeEditor.prototype.commitPrepared.call(this, prepared); }
  };
  model.onDidChange(() => {
    if (editor.applying) editor.selections = model.selections.map(selection => ({...selection}));
  });
  editor.presentation = new EditorPresentation(editor);
  return {editor, notifications};
}

function boundedSource(source, maximum, reads) {
  return Object.freeze({
    length: source.length, lineCount: source.lineCount,
    lineStart: line => source.lineStart(line), lineEnd: line => source.lineEnd(line),
    getLine() { throw new Error('Logical lines must remain unmaterialized'); },
    getText(start, end) {
      assert.ok(Number.isInteger(end), 'Every read has an explicit end');
      assert.ok(end - start <= maximum, 'A normalization read must remain bounded');
      reads.push(end - start);
      return source.getText(start, end);
    }
  });
}

test('A20 a no-option save of an actual 200 MiB line is synchronous; enabled tail trim commits once without a whole-text view', async () => {
  const length = 200 * 1024 * 1024;
  const model = new EditorModel('x'.repeat(length - 3) + ' \t ', {uri: 'Huge.cs'});
  const {editor, notifications} = editorFor(model);
  const before = model.snapshot();
  const zeroRead = Object.freeze({length, getText() { throw new Error('A no-op must not read text'); },
    getLine() { throw new Error('A no-op must not read lines'); }});
  assert.deepEqual(saveTextEdits(zeroRead, {normalizeLineEndings: false}), []);
  const result = editor.presentation.prepareSave();
  assert.equal(result, before);
  assert.equal(result.then, undefined);
  assert.equal(model.undoStack.depth, 0);
  assert.deepEqual(notifications, []);
  editor.options = editorOptions({trimTrailingWhitespace: true});
  const pending = editor.presentation.prepareSave();
  assert.equal(typeof pending.then, 'function');
  assert.equal(model.snapshot(), before);
  const after = await pending;
  assert.equal(after, model.snapshot());
  assert.equal(model.length, length - 3);
  assert.equal(model.version, before.version + 1);
  assert.equal(model.undoStack.depth, 1);
  assert.deepEqual(notifications, ['beforeEdit', 'afterEdit']);
  assert.equal(before.statistics.textMaterialized, false);
  assert.equal(after.statistics.textMaterialized, false);
  assert.equal(model.undo(), true);
  assert.equal(model.length, length);
  assert.equal(model.getText(length - 3, length), ' \t ');
  model.dispose();
});

test('A20 trailing-whitespace scans use bounded backward windows and yield before finishing a long logical line', async () => {
  const model = new EditorModel('start' + ' '.repeat(200_000) + '\r\nnext\t');
  const reads = [];
  const source = boundedSource(model.snapshot(), 1024, reads);
  let timerRan = false;
  let progress = 0;
  const edits = await saveTextEditsAsync(source, {
    trimTrailingWhitespace: true, normalizeLineEndings: true, endOfLine: '\n', insertFinalNewline: true
  }, {chunkSize: 1024, onProgress() {
    if (!progress++) setTimeout(() => { timerRan = true; }, 0);
    else assert.equal(timerRan, true);
  }});
  assert.ok(progress > 1);
  assert.ok(reads.length > 100);
  assert.equal(Math.max(...reads), 1024);
  model.commitPrepared(await model.prepareEditsAsync(edits, {chunkSize: 1024, undoStop: true}));
  assert.equal(model.getText(), 'start\nnext\n');
  assert.equal(model.undoStack.depth, 1);
  assert.equal(model.undo(), true);
  assert.equal(model.length, 200_012);
  model.dispose();
});

test('A20 save normalization matches terminator/trim semantics while preserving significant whitespace and one undo transaction', async () => {
  const texts = ['', '   ', 'a  \r\nb\t\nc \rd\u00a0\u2003', 'a\r\n', '\n \t', '\t\r\n\r\n'];
  for (const original of texts) {
    for (const normalizeLineEndings of [false, true]) {
      const model = new EditorModel(original);
      const {editor} = editorFor(model, {trimTrailingWhitespace: true, insertFinalNewline: true, endOfLine: '\r\n'});
      editor.endOfLineExplicit = normalizeLineEndings;
      let expected = original.replace(/[\t ]+(?=\r\n|\r|\n|$)/g, '');
      if (normalizeLineEndings) expected = expected.replace(/\r\n|\r|\n/g, '\r\n');
      if (original && !/[\r\n]$/.test(original)) expected += '\r\n';
      await editor.presentation.prepareSave({chunkSize: 1, batchSize: 1});
      assert.equal(model.getText(), expected);
      if (expected !== original) {
        assert.equal(model.undoStack.depth, 1);
        assert.equal(model.undo(), true);
        assert.equal(model.getText(), original);
      } else assert.equal(model.undoStack.depth, 0);
      model.dispose();
    }
  }
});

test('A20 aborted normalization leaves source, selections, dirty marker and undo history untouched', async () => {
  const model = new EditorModel('source' + ' '.repeat(10_000), {selections: [{anchor: 2, active: 5}]});
  model.markSaved();
  const {editor, notifications} = editorFor(model, {trimTrailingWhitespace: true});
  const original = model.snapshot();
  const selections = model.selections;
  const controller = new AbortController();
  await assert.rejects(editor.presentation.prepareSave({signal: controller.signal, chunkSize: 32,
    onProgress() { controller.abort(); }}), {name: 'AbortError'});
  assert.equal(model.snapshot(), original);
  assert.equal(model.selections, selections);
  assert.equal(model.isDirty, false);
  assert.equal(model.undoStack.depth, 0);
  assert.deepEqual(notifications, []);
  editor.options = editorOptions();
  assert.throws(() => editor.presentation.prepareSave({signal: controller.signal}), {name: 'AbortError'});
  model.dispose();
});

test('A20 changed source, replaced model and changed text options reject private normalization before commit', async () => {
  for (const mutation of ['edit', 'replace', 'options', 'dispose']) {
    const model = new EditorModel('original' + ' '.repeat(10_000));
    const {editor, notifications} = editorFor(model, {trimTrailingWhitespace: true});
    const before = model.snapshot();
    let changed = false;
    await assert.rejects(editor.presentation.prepareSave({chunkSize: 32, onProgress() {
      if (changed) return;
      changed = true;
      if (mutation === 'edit') model.applyEdits([{start: 0, end: 0, text: 'typed '}]);
      if (mutation === 'replace') editor.model = new EditorModel('new workspace', {uri: model.uri});
      if (mutation === 'options') editor.optionsRevision++;
      if (mutation === 'dispose') editor.disposed = true;
    }}), {code: 'SFEDITOR_SAVE_STALE'});
    assert.deepEqual(notifications, []);
    assert.equal(model.undoStack.depth, mutation === 'edit' ? 1 : 0);
    assert.equal(model.length, before.length + (mutation === 'edit' ? 6 : 0));
    if (editor.model !== model) editor.model.dispose();
    model.dispose();
  }
});

test('A20 private preparation rejects invalid limits and excessive edits without applying a partial line batch', async () => {
  const model = new EditorModel('a \nb \nc \nd ', {maxEdits: 3});
  const {editor} = editorFor(model, {trimTrailingWhitespace: true});
  const before = model.snapshot();
  await assert.rejects(editor.presentation.prepareSave(), /edit limit/);
  for (const settings of [{chunkSize: 0}, {chunkSize: 65_537}, {batchSize: 0}, {batchSize: 257}, {onProgress: true}]) {
    await assert.rejects(editor.presentation.prepareSave(settings), /Invalid|must contain/);
    assert.equal(model.snapshot(), before);
    assert.equal(model.undoStack.depth, 0);
  }
  model.dispose();
});

test('A20 prepared commits use the latest view selections and the shared contribution transaction', async () => {
  const model = new EditorModel('a  \r\nb  \r\n');
  const {editor, notifications} = editorFor(model, {trimTrailingWhitespace: true, endOfLine: '\n'});
  editor.endOfLineExplicit = true;
  const pending = editor.presentation.prepareSave({batchSize: 1, onProgress() {
    editor.selections = [{anchor: 5, active: 6}];
  }});
  await pending;
  assert.deepEqual(model.selections.map(({anchor, active}) => ({anchor, active})), [{anchor: 2, active: 3}]);
  assert.deepEqual(notifications, ['beforeEdit', 'afterEdit']);
  assert.equal(model.undoStack.depth, 1);
  model.undo();
  assert.deepEqual(model.selections.map(({anchor, active}) => ({anchor, active})), [{anchor: 5, active: 6}]);
  model.dispose();
});

test('A20 trimming before a requested final newline retains a content-end caret before that new terminator', async () => {
  const model = new EditorModel('text  ', {selections: [{anchor: 4, active: 4}]});
  const {editor} = editorFor(model, {trimTrailingWhitespace: true, insertFinalNewline: true});
  await editor.presentation.prepareSave();
  assert.equal(model.getText(), 'text\n');
  assert.equal(model.primarySelection.active, 4);
  assert.equal(model.undoStack.depth, 1);
  model.undo();
  assert.equal(model.getText(), 'text  ');
  assert.equal(model.primarySelection.active, 4);
  model.dispose();
});

test('A20 a shared read-only transition during preparation never changes the buffer', async () => {
  const model = new EditorModel('original' + ' '.repeat(10_000));
  const {editor} = editorFor(model, {trimTrailingWhitespace: true});
  const before = model.snapshot();
  await assert.rejects(editor.presentation.prepareSave({chunkSize: 1024, onProgress() { model.readOnly = true; }}), {
    code: 'SFEDITOR_READ_ONLY'
  });
  assert.equal(model.snapshot(), before);
  assert.equal(model.undoStack.depth, 0);
  model.dispose();
});
