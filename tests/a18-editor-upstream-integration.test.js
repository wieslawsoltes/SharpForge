import test from 'node:test';
import assert from 'node:assert/strict';
import {CodeEditor, EditorModel, SyntaxHighlightIndex, bracketPairs} from '@sharpforge/editor';
import {lex} from '@sharpforge/syntax';
import {createVirtualEditor, sourceRows} from './fixtures/a18-virtual-editor-dom.js';

test('A18 editor: mutable model updates retain old lexical snapshots and match complete scans', () => {
  const text = Array.from({length: 3000}, (_, line) => `int value${line} = ${line}; // row\n`).join('');
  const model = new EditorModel(text, {uri: 'Incremental.cs'});
  const initialSource = model.snapshot();
  const index = new SyntaxHighlightIndex(initialSource);
  const retained = index.lexed;
  const tokens = retained.tokens;
  const start = text.indexOf('= 1500') + 2;
  const event = model.applyEdits([{start, end: start + 4, text: '9000'}]);
  index.update(model.snapshot(), event);
  assert.equal(index.source, model.snapshot());
  assert(index.metrics.relexedLines < 200);
  assert(index.metrics.resynced);
  assert.equal(retained.tokens, tokens);
  assert.deepEqual(retained.tokens, lex(initialSource).tokens);
  assert.deepEqual(index.lexed.tokens, lex(model.snapshot()).tokens);
  assert.equal(index.lexed.tokens[0], tokens[0]);
  assert.equal(index.lexed.tokens.at(-2), tokens.at(-2));
  const independent = index.withSource(model.snapshot());
  assert.equal(independent, index);
  const currentTokens = index.tokens;
  index.update(model.snapshot());
  assert.equal(index.tokens, currentTokens, 'refreshing the same immutable model revision does not relex');
  index.dispose();
  model.dispose();
});

test('A18 editor: model quote edits invalidate phantom bracket offsets even before color work completes', () => {
  const model = new EditorModel('"()" () ""', {uri: 'Quotes.cs'});
  const index = new SyntaxHighlightIndex(model.snapshot());
  assert.equal(index.brackets.get(5), 6);
  const event = model.applyEdits([{start: 0, end: 1, text: ''}]);
  index.update(model.snapshot(), event);
  const expected = bracketPairs(model.getText(), lex(model.snapshot()).tokens);
  for (let offset = 0; offset <= model.length; offset++) assert.equal(index.brackets.get(offset), expected.get(offset));
  assert.equal(index.brackets.get(4), undefined);
  assert.equal(index.brackets.get(0), 1);
  assert.equal(index.contextAt(5), 'literal');
  index.dispose();
  model.dispose();
});

test('A18 editor: native input remains bounded while public text and multi-caret edits use the shared model', t => {
  const fixture = createVirtualEditor(t);
  const {editor, document} = fixture;
  const text = ('int n = 1;\n').repeat(3000);
  editor.setModel('Native.cs', text);
  const first = editor.model.offsetAt({line: 1400, character: 8});
  const second = editor.model.offsetAt({line: 1600, character: 8});
  editor.setSelections([{anchor: first, active: first + 1}, {anchor: second, active: second + 1}], {primaryIndex: 1});
  const native = Object.getOwnPropertyDescriptor(document.defaultView.HTMLTextAreaElement.prototype, 'value');
  assert.equal(editor.input.value, text);
  assert(native.get.call(editor.input).length <= 2048);
  assert.equal(editor.input.selectionStart, second);
  assert.equal(editor.input.selectionEnd, second + 1);
  const event = editor.input.dispatch('beforeinput', {inputType: 'insertText', data: '7'});
  assert(event.defaultPrevented);
  assert.equal(editor.model.getText(first, first + 1), '7');
  assert.equal(editor.model.getText(second, second + 1), '7');
  assert.equal(editor.getSelections().length, 2);
  assert.equal(editor.history.length, 1);
  assert(native.get.call(editor.input).length <= 2048);
  editor.undo();
  assert.equal(editor.value, text);
  assert.deepEqual(editor.getSelections().map(({anchor, active}) => [anchor, active]), [[first, first + 1], [second, second + 1]]);
  for (const profile of ['visual-studio', 'vscode', 'vim', 'emacs', 'sublime']) {
    editor.setKeymap(profile);
    assert.equal(editor.keymap, profile);
    assert.equal(editor.value, text);
  }
});

test('A18 editor: model-first rollback restores independent linked views and rejects a stale owner revision', t => {
  const fixture = createVirtualEditor(t);
  const {editor, document} = fixture;
  const text = 'class C {\n  void M() {\n    int x = 1;\n  }\n}\n';
  editor.setModel('Rollback.cs', text);
  const host = document.createElement('main');
  document.body.append(host);
  const second = new CodeEditor(host, {model: editor.model, session: editor.session, splitChild: true});
  t.after(() => second.dispose());
  editor.setSelections([{anchor: 0, active: 5}]);
  second.setSelections([{anchor: 15, active: 20}]);
  editor.folding.setRanges([{startLine: 1, endLine: 3, collapsed: true}], editor.model.lineCount);
  editor.toggleBookmark(2);
  second.toggleBookmark(1);
  editor.setDiagnostics([{start: 6, length: 1, severity: 'warning', message: 'Original diagnostic'}]);
  editor.setExecutionLocation({line: 1, start: 0, end: 5}, {description: 'Original frame'});
  fixture.flushFrames();
  const selections = [editor.getSelections(), second.getSelections()];
  const checkpoint = editor.model.checkpoint();
  const viewCheckpoint = editor.captureViewCheckpoint();
  editor.onEdits = () => editor.setDiagnostics([{start: 10, length: 2, severity: 'error', message: 'Failed revision'}]);
  editor.applyEdits([{start: 0, end: 0, text: '// added\n'}], {source: 'designer', undoStop: true});
  assert.equal(second.value, editor.value);
  assert(editor.bookmarks.has(3));
  assert.throws(() => editor.restoreViewCheckpoint(viewCheckpoint), /owning model revision/);
  editor.setReadOnly(true);
  editor.model.restoreCheckpoint(checkpoint);
  editor.restoreViewCheckpoint(viewCheckpoint);
  assert.equal(editor.model.readOnly, true, 'rollback does not release an independently acquired document lock');
  assert.equal(editor.value, text);
  assert.equal(second.value, text);
  assert.equal(editor.history.length, 0);
  assert.deepEqual([editor.getSelections(), second.getSelections()], selections);
  assert.deepEqual([...editor.bookmarks.lines], [2]);
  assert.deepEqual([...second.bookmarks.lines], [1]);
  assert.equal(editor.bookmarks.past.length, 0);
  assert.equal(editor.changeTracking.touched.size, 0);
  assert.equal(editor.folding.at(1).collapsed, true);
  assert.equal(editor.diagnostics[0].message, 'Original diagnostic');
  assert.equal(editor.executionDetails.description, 'Original frame');
  for (const view of [editor, second]) {
    assert.equal(view.highlightIndex.source, view.sourceSnapshot());
    assert.equal(view.input.value, text);
    assert.equal(view.foldingProvider.timer, null);
  }
  assert.equal(sourceRows(second).join('\n'), text);
  editor.insights.nextDiagnostic(1);
  assert.equal(editor.offset, 6, 'diagnostic navigation must use the restored diagnostic, not the failed revision');
  assert.throws(() => second.restoreViewCheckpoint(viewCheckpoint), /owning model revision/);
});

test('A18 editor: rollback cancels a failed transaction deferred full-text notification', async t => {
  const changes = [];
  const fixture = createVirtualEditor(t, {options: {largeFileThreshold: 30}, onChange: value => changes.push(value)});
  const {editor} = fixture;
  editor.setModel('Deferred.cs', 'int original = 1;\n');
  assert.equal(editor.largeFile.active, false);
  const checkpoint = editor.model.checkpoint();
  const viewCheckpoint = editor.captureViewCheckpoint();
  editor.applyEdits([{start: 0, end: 0, text: '// failed transaction\n'}], {source: 'designer', undoStop: true});
  assert.equal(editor.largeFile.active, true);
  assert(editor.changeTimer);
  assert.deepEqual(changes, []);
  editor.model.restoreCheckpoint(checkpoint);
  editor.restoreViewCheckpoint(viewCheckpoint);
  assert.equal(editor.changeTimer, null);
  assert.equal(editor.largeFile.active, false);
  assert.equal(editor.element.dataset.largeFile, 'false');
  await new Promise(resolve => setTimeout(resolve, 170));
  assert.deepEqual(changes, []);
  assert.equal(editor.value, 'int original = 1;\n');
});

test('A18 editor: rollback attempts every linked view when a presentation contribution throws', t => {
  const fixture = createVirtualEditor(t, {options: {largeFileThreshold: 10}, onChange() {}});
  const {editor, document} = fixture;
  editor.setModel('Shared.cs', 'int original = 1;\n');
  const host = document.createElement('main');
  document.body.append(host);
  const second = new CodeEditor(host, {model: editor.model, session: editor.session,
    options: {largeFileThreshold: 10}, onChange() {}});
  t.after(() => second.dispose());
  second.setSelections([{anchor: 4, active: 12}]);
  second.setDiagnostics([{start: 4, length: 8, severity: 'warning', message: 'Original'}]);
  fixture.flushFrames();
  const expected = second.getSelections();
  const model = editor.model.checkpoint();
  const view = editor.captureViewCheckpoint();
  editor.applyEdits([{start: 0, end: 0, text: '// failed\n'}], {undoStop: true});
  assert(editor.changeTimer);
  assert(second.changeTimer);
  const failure = new Error('Render consumer failed');
  const remove = editor.registerContribution({render() { throw failure; }});
  editor.model.restoreCheckpoint(model);
  assert.throws(() => editor.restoreViewCheckpoint(view), error => error === failure || error instanceof AggregateError);
  remove();
  assert.equal(editor.changeTimer, null);
  assert.equal(second.changeTimer, null);
  assert.equal(second.value, 'int original = 1;\n');
  assert.deepEqual(second.getSelections(), expected);
  assert.equal(second.diagnostics[0].message, 'Original');
  assert.equal(sourceRows(second).join('\n'), second.value);
});

test('A18 editor: native scroll clamping cannot discard the position while a longer source is restored', t => {
  const fixture = createVirtualEditor(t);
  const {editor} = fixture;
  editor.setModel('ScrollRollback.cs', '// ' + 'wide '.repeat(200) + '\n' + 'int n = 1;\n'.repeat(1000));
  fixture.flushFrames();
  const viewport = editor.view.viewport;
  viewport.clampScroll = true;
  editor.view.scrollTo({top: 20000, left: 100});
  fixture.flushFrames();
  const position = {top: editor.view.scrollTop, left: viewport.scrollLeft};
  assert.equal(position.top, 20000);
  assert.equal(position.left, 100);
  const model = editor.model.checkpoint();
  const view = editor.captureViewCheckpoint();
  editor.setValue('x');
  editor.paintViewport();
  viewport.scrollTo({top: 0, left: 0});
  assert.equal(viewport.scrollHeight, viewport.clientHeight);
  editor.model.restoreCheckpoint(model);
  editor.restoreViewCheckpoint(view);
  assert.deepEqual({top: editor.view.scrollTop, left: viewport.scrollLeft}, position);
  assert(editor.highlightMetrics.firstLine > 800);
});

test('A18 editor: a reused numeric version cannot restore another source branch view checkpoint', t => {
  const {editor} = createVirtualEditor(t);
  editor.setModel('Branches.cs', 'int initial = 1;');
  const original = editor.model.checkpoint();
  editor.setValue('int longerBranch = 2;');
  const previousView = editor.captureViewCheckpoint();
  editor.model.restoreCheckpoint(original);
  editor.refreshPreview();
  editor.setValue('int other = 3;');
  assert.equal(editor.model.version, previousView.version);
  assert.notEqual(editor.sourceSnapshot(), previousView.source);
  assert.throws(() => editor.restoreViewCheckpoint(previousView), /owning model revision/);
  assert.equal(editor.value, 'int other = 3;');
});

test('A18 editor: inserting before a collapsed lower fold preserves bounded layout and native undo', t => {
  const fixture = createVirtualEditor(t);
  const {editor} = fixture;
  editor.setModel('Folded.cs', 'a\nb\nc\nd\ne');
  editor.folding.setRanges([{startLine: 2, endLine: 3, collapsed: true}], editor.model.lineCount);
  editor.applyEdits([{start: 0, end: 0, text: '\n'.repeat(5)}], {source: 'designer', undoStop: true});
  assert.equal(editor.folding.at(7).collapsed, true);
  assert.equal(editor.view.layout.map.lineCount, editor.model.lineCount);
  assert.equal(editor.view.layout.map.counts[8], 0);
  fixture.flushFrames();
  editor.undo();
  assert.equal(editor.value, 'a\nb\nc\nd\ne');
  assert.equal(editor.folding.at(2).collapsed, true);
  assert.equal(editor.view.layout.map.counts[3], 0);
});
