import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel, advancedCommands, editorOptions, parseEditorConfig, resolveEditorConfig, saveTextEdits,
  ClipboardRing, dragTextEdits, BookmarkModel, ChangeTracking, LargeFilePolicy} from '@sharpforge/editor';
import {EditorEditing} from '../packages/editor/src/core/editing.js';

function editorFixture(text, selections = [{anchor: 0, active: 0}]) {
  const model = new EditorModel(text, {selections});
  const editor = {model, options: editorOptions(), input: {readOnly: false}, overtype: false,
    getSelections: () => model.selections, setSelections: value => model.setSelections(value),
    applyEdits: (edits, options) => model.applyEdits(edits, {...options, command: options?.source ?? 'test'}),
    accessibility: {announce() {}}, moveLines() { throw new Error('Use actual EditorEditing.moveLines'); }};
  editor.editing = new EditorEditing(editor);
  editor.moveLines = direction => editor.editing.moveLines(direction);
  return editor;
}

test('A20 multi-caret editing commits one undo group and grapheme delete preserves boundaries', () => {
  const editor = editorFixture('a👩‍💻b\nx🇵🇱y', [{anchor: 1, active: 1}, {anchor: 9, active: 9}]);
  editor.editing.insertText('!');
  assert.equal(editor.model.getText(), 'a!👩‍💻b\nx!🇵🇱y');
  assert.equal(editor.model.undoStack.depth, 1);
  editor.model.undo();
  assert.equal(editor.model.getText(), 'a👩‍💻b\nx🇵🇱y');
  editor.model.setSelections([{anchor: 1, active: 1}]);
  editor.editing.deleteText(1);
  assert.equal(editor.model.getText(), 'ab\nx🇵🇱y');
});

test('A20 deletion boundaries and smart newline at EOF are valid no-ops or atomic edits', () => {
  const editor = editorFixture('');
  editor.editing.deleteText(-1);
  editor.editing.deleteText(1);
  assert.equal(editor.model.undoStack.depth, 0);
  editor.model.setValue('{');
  editor.model.setSelections([{anchor: 1, active: 1}]);
  editor.editing.insertNewline();
  assert.equal(editor.model.getText(), '{\n    ');
  editor.model.setValue('a\n');
  editor.model.setSelections([{anchor: 1, active: 1}]);
  editor.editing.deleteText(1);
  assert.equal(editor.model.getText(), 'a');
});

test('A20 overtype never replaces a newline and virtual space is materialized only by typing', () => {
  const editor = editorFixture('ab\ncd', [{anchor: 1, active: 1}]);
  editor.overtype = true;
  editor.editing.insertText('X');
  assert.equal(editor.model.getText(), 'aX\ncd');
  editor.editing.insertText('Y');
  assert.equal(editor.model.getText(), 'aXY\ncd');
  editor.model.setSelections([{anchor: 3, active: 3, activeVirtualSpace: 3}]);
  editor.overtype = false;
  editor.editing.insertText('!');
  assert.equal(editor.model.getText(), 'aXY   !\ncd');
});

test('A20 advanced transforms preserve multi-caret atomicity and Unicode case expansion', () => {
  const editor = editorFixture('straße one\nhello two', [{anchor: 0, active: 6}, {anchor: 11, active: 16}]);
  advancedCommands(editor)['edit.uppercase']();
  assert.equal(editor.model.getText(), 'STRASSE one\nHELLO two');
  assert.equal(editor.model.undoStack.depth, 1);
  editor.model.undo();
  assert.equal(editor.model.getText(), 'straße one\nhello two');
  editor.model.setSelections([{anchor: 0, active: editor.model.length}]);
  advancedCommands(editor)['edit.blockComment']();
  assert.equal(editor.model.getText(), '/*straße one\nhello two*/');
});

test('A20 editorconfig precedence changes indentation per path and save applies EOL trim/final newline', () => {
  const files = [{directory: '', text: 'root=true\n[*]\nindent_style=space\nindent_size=4\nend_of_line=lf\n'},
    {directory: 'src', text: '[*.cs]\nindent_style=tab\ntab_width=8\nindent_size=tab\ntrim_trailing_whitespace=true\ninsert_final_newline=true'}];
  const options = resolveEditorConfig('src/Program.cs', files);
  assert.equal(options.insertSpaces, false);
  assert.equal(options.tabSize, 8);
  assert.equal(options.indentSize, 8);
  assert.equal(resolveEditorConfig('readme.txt', files).indentSize, 4);
  const model = new EditorModel('one  \r\ntwo\t');
  model.applyEdits(saveTextEdits(model, editorOptions(options)));
  assert.equal(model.getText(), 'one\ntwo\n');
  assert.throws(() => parseEditorConfig('[*.cs]\ninvalid-property'), SyntaxError);
  assert.throws(() => editorOptions({zoom: 401}), RangeError);
});

test('A20 clipboard ring bounds entries and drag move preserves one undo transaction', () => {
  const ring = new ClipboardRing();
  for (let index = 0; index < 20; index++) ring.push(`item ${index}`);
  assert.equal(ring.entries.length, 15);
  assert.equal(ring.entries[0], 'item 19');
  const model = new EditorModel('abc def ghi');
  const prepared = dragTextEdits(model, 4, 7, 0);
  model.applyEdits(prepared.edits, {selections: prepared.selections, undoStop: true});
  assert.equal(model.getText(), 'defabc  ghi');
  assert.equal(model.undoStack.depth, 1);
  model.undo();
  assert.equal(model.getText(), 'abc def ghi');
  assert.equal(dragTextEdits(model, 4, 7, 5).edits.length, 0);
  assert.throws(() => dragTextEdits(model, -1, 3, 5), RangeError);
});

test('A20 bookmarks and unsaved/saved/reverted change marks follow undo', () => {
  const model = new EditorModel('one\ntwo\nthree');
  const bookmarks = new BookmarkModel(model);
  const tracking = new ChangeTracking(model);
  bookmarks.toggle(2);
  model.onDidChange(event => { bookmarks.applyChange(event); tracking.applyChange(event); });
  model.applyEdits([{start: 0, end: 0, text: 'new\n'}]);
  assert(bookmarks.has(3));
  assert.equal(tracking.stateAt(0), 'unsaved');
  model.undo();
  assert(bookmarks.has(2));
  assert.equal(tracking.stateAt(0), null);
  model.applyEdits([{start: 0, end: 3, text: 'ONE'}]);
  tracking.markSaved();
  assert.equal(tracking.stateAt(0), 'saved');
  model.applyEdits([{start: 0, end: 3, text: 'other'}]);
  assert.equal(tracking.stateAt(0), 'unsaved');
  model.undo();
  assert.equal(tracking.stateAt(0), 'saved');
});

test('A20 chunk loading commits once and cancellation or malformed UTF-8 keeps original model', async () => {
  const original = new EditorModel('original', {uri: 'file.cs'});
  const editor = {model: original, uri: 'file.cs', disposed: false, setModel(uri, model) { this.uri = uri; this.model = model; }};
  const policy = new LargeFilePolicy(editor);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(policy.load(new Blob(['replacement']), {signal: aborted.signal}), {name: 'AbortError'});
  assert.equal(editor.model, original);
  await assert.rejects(policy.load(new Blob([Uint8Array.of(0xff)])), TypeError);
  assert.equal(editor.model, original);
  await policy.load(new Blob(['日本語\n', 'a\n']), {chunkSize: 2});
  assert.equal(editor.model.getText(), '日本語\na\n');
  assert.equal(editor.model.undoStack.depth, 0);
  policy.dispose();
});

test('A20 advanced caret transforms and disjoint line moves preserve EOLs and undo selections', () => {
  const editor = editorFixture('one two\r\nthree four\r\nfive six\r\nseven eight', [{anchor: 4, active: 4}, {anchor: 26, active: 26}]);
  const before = editor.model.getText();
  const selected = editor.model.selections.map(selection => ({...selection}));
  editor.editing.moveLines(1);
  assert.equal(editor.model.getText(), 'three four\r\none two\r\nseven eight\r\nfive six');
  assert.equal(editor.model.undoStack.depth, 1);
  const after = editor.model.selections.map(selection => ({...selection}));
  editor.model.undo();
  assert.equal(editor.model.getText(), before);
  assert.deepEqual(editor.model.selections, selected);
  editor.model.redo();
  assert.deepEqual(editor.model.selections, after);
  editor.model.setValue('one two\nx y');
  editor.model.setSelections([{anchor: 4, active: 4}, {anchor: 10, active: 10}]);
  advancedCommands(editor)['edit.transposeWord']();
  assert.equal(editor.model.getText(), 'two one\ny x');
  editor.model.setValue('hello\r\n  world');
  editor.model.setSelections([{anchor: 2, active: 2}]);
  advancedCommands(editor)['edit.uppercase']();
  assert.equal(editor.model.getText(), 'HELLO\r\n  world');
  advancedCommands(editor)['edit.joinLines']();
  assert.equal(editor.model.getText(), 'HELLO world');
});

test('A20 advanced sorting preserves CRLF and read-only rejects transforms', () => {
  const editor = editorFixture('z\r\na\r\nb', [{anchor: 0, active: 7}]);
  advancedCommands(editor)['edit.sortLines']();
  assert.equal(editor.model.getText(), 'a\r\nb\r\nz');
  editor.input.readOnly = true;
  for (const command of ['edit.uppercase', 'edit.transposeCharacter', 'edit.transposeWord', 'edit.joinLines', 'edit.indent']) {
    advancedCommands(editor)[command]();
    assert.equal(editor.model.getText(), 'a\r\nb\r\nz');
  }
});
