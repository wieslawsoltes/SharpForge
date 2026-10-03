import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorModel } from '../packages/editor/src/model.js';
import { createNativeEditor, deferred, keyboardEvent, selectionPairs } from './support/native-editor-fixture.js';

test('profile switches preserve the authoritative model, undo, primary selection, view and native state', async () => {
  const editor = createNativeEditor('one\ntwo', { selections: [[1, 1], [6, 4]], primaryIndex: 1 });
  editor.insertText('X', { undoStop: true });
  editor.setSelections([{ anchor: 3, active: 1 }, { anchor: 5, active: 5 }], { primaryIndex: 1 });
  editor.view.scrollTo({ top: 120, left: 30 });
  editor.folding.setRanges([{ startLine: 0, endLine: 1, collapsed: true }], editor.model.lineCount);
  editor.adapter.emacs.push('retained kill');
  editor.adapter.emacs.mark = 3;
  editor.adapter.vim.registers.write('a', 'retained register');
  editor.adapter.vim.marks.set('a', { uri: editor.uri, offset: 2 });
  const model = editor.model;
  const value = editor.value;
  const selections = selectionPairs(editor);
  const history = model.undoStack.statistics;
  for (const profile of ['visual-studio', 'emacs', 'vim', 'sublime', 'vscode']) {
    editor.adapter.setMode(profile);
    assert.equal(editor.model, model);
    assert.equal(editor.value, value);
    assert.deepEqual(selectionPairs(editor), selections);
    assert.equal(editor.primaryIndex, 1);
    assert.deepEqual(model.undoStack.statistics, history);
    assert.equal(editor.view.scrollTop, 120);
    assert.equal(editor.view.scrollLeft, 30);
    assert.equal(editor.folding.hidden(1), true);
    assert.equal(editor.adapter.emacs.ring[0], 'retained kill');
    assert.equal(editor.adapter.emacs.mark, 3);
    assert.equal((await editor.adapter.vim.registers.read('a')).text, 'retained register');
    assert.equal(editor.adapter.vim.marks.get('a').offset, 2);
  }
  editor.undo();
  assert.equal(editor.value, 'one\ntwo');
  editor.dispose();
});

test('resuming Vim insert after a profile switch opens a new complete undo group', async () => {
  const editor = createNativeEditor('', { mode: 'vim' });
  await editor.feed(['i', 'A', 'B']);
  editor.adapter.setMode('vscode');
  assert.equal(editor.adapter.vim.inUndoGroup, false);
  editor.insertText('X', { undoStop: true });
  editor.adapter.setMode('vim');
  assert.equal(editor.adapter.vim.mode, 'insert');
  assert.equal(editor.adapter.vim.inUndoGroup, true);
  await editor.feed(['C', 'D', 'Escape']);
  assert.equal(editor.value, 'ABXCD');
  assert.equal(editor.model.undoStack.depth, 3);
  editor.undo();
  assert.equal(editor.value, 'ABX');
  editor.undo();
  assert.equal(editor.value, 'AB');
  editor.undo();
  assert.equal(editor.value, '');
  editor.dispose();
});

test('Emacs mark extends motion, exchanges ends and kills the marked region with one undo', async () => {
  const editor = createNativeEditor('abcdef', { mode: 'emacs', selections: [[1, 1]] });
  await editor.press('Ctrl+Space');
  await editor.press('Ctrl+F');
  await editor.press('Ctrl+F');
  assert.deepEqual(selectionPairs(editor), [[1, 3]]);
  await editor.press('Ctrl+X Ctrl+X');
  assert.deepEqual(selectionPairs(editor), [[3, 1]]);
  assert.equal(editor.adapter.emacs.mark, 3);
  await editor.press('Ctrl+W');
  assert.equal(editor.value, 'adef');
  assert.equal(editor.adapter.emacs.ring[0], 'bc');
  assert.equal(editor.adapter.emacs.markActive, false);
  editor.undo();
  assert.equal(editor.value, 'abcdef');
  assert.deepEqual(selectionPairs(editor), [[3, 1]]);
  editor.dispose();
});

test('Emacs successive kills append, yank cycles distinct entries, and unrelated commands end a yank chain', async () => {
  const editor = createNativeEditor('alpha beta\ngamma', { mode: 'emacs' });
  await editor.press('Ctrl+K');
  await editor.press('Ctrl+K');
  assert.equal(editor.value, 'gamma');
  assert.equal(editor.adapter.emacs.ring[0], 'alpha beta\n');
  await editor.press('Ctrl+Y');
  assert.equal(editor.value, 'alpha beta\ngamma');
  editor.dispose();
  const other = createNativeEditor('one two three', { mode: 'emacs' });
  await other.press('Alt+D');
  await other.press('Ctrl+G');
  await other.press('Alt+D');
  assert.deepEqual(other.adapter.emacs.ring, ['two ', 'one ']);
  await other.press('Ctrl+Y');
  assert.equal(other.value, 'two three');
  await other.press('Alt+Y');
  assert.equal(other.value, 'one three');
  await other.press('Alt+Y');
  assert.equal(other.value, 'two three');
  await other.press('Ctrl+F');
  assert.throws(() => other.adapter.execute('Emacs.YankPop'), /immediately/);
  assert.equal(other.value, 'two three');
  other.dispose();
});

test('Emacs ring bounds and marks stay independent between views and track document edits', () => {
  const first = createNativeEditor('abcdef', { mode: 'emacs' });
  const second = createNativeEditor('abcdef', { mode: 'emacs' });
  first.adapter.emacs.mark = 4;
  first.adapter.emacs.push('private');
  first.applyEdits([{ start: 0, end: 0, text: '++' }], { undoStop: true });
  assert.equal(first.adapter.emacs.mark, 6);
  assert.equal(second.adapter.emacs.mark, null);
  assert.deepEqual(second.adapter.emacs.ring, []);
  first.adapter.emacs.maxCharacters = 5;
  assert.throws(() => first.adapter.emacs.push('oversized'), /budget/);
  first.dispose(); second.dispose();
});

test('Sublime occurrences and split-line carets edit the actual model atomically', async () => {
  const editor = createNativeEditor('cat cat\ncat', { mode: 'sublime', selections: [[1, 1]] });
  await editor.press('Mod+D');
  await editor.press('Mod+D');
  await editor.press('Mod+D');
  assert.deepEqual(selectionPairs(editor), [[0, 3], [4, 7], [8, 11]]);
  assert.equal(editor.primaryIndex, 2);
  editor.insertText('dog', { undoStop: true });
  assert.equal(editor.value, 'dog dog\ndog');
  assert.equal(editor.model.undoStack.depth, 1);
  editor.undo();
  assert.equal(editor.value, 'cat cat\ncat');
  assert.equal(editor.primaryIndex, 2);
  editor.setSelections([{ anchor: 0, active: editor.model.length }]);
  await editor.press('Mod+Shift+L');
  assert.deepEqual(selectionPairs(editor), [[7, 7], [11, 11]]);
  editor.insertText('!', { undoStop: true });
  assert.equal(editor.value, 'cat cat!\ncat!');
  editor.dispose();
});

test('native text edits preserve CRLF and deduplicate two carets on one copied line', async () => {
  const editor = createNativeEditor('one\r\ntwo', { selections: [[1, 1], [2, 2]], options: { endOfLine: '\r\n' } });
  await editor.press('Alt+Shift+ArrowDown');
  assert.equal(editor.value, 'one\r\none\r\ntwo');
  assert.equal(editor.model.undoStack.depth, 1);
  editor.undo();
  await editor.press('Mod+Enter');
  assert.equal(editor.value, 'one\r\n\r\ntwo');
  editor.dispose();
});

test('clipboard distributes multiline fragments, remembers line copy and undoes all caret pastes together', async () => {
  const editor = createNativeEditor('a\nb', { selections: [[0, 1], [2, 3]] });
  editor.clipboardText = 'ONE\nTWO';
  await editor.adapter.execute('Edit.Paste');
  assert.equal(editor.value, 'ONE\nTWO');
  assert.equal(editor.model.undoStack.depth, 1);
  editor.undo();
  assert.deepEqual(selectionPairs(editor), [[0, 1], [2, 3]]);
  editor.goto(1);
  await editor.adapter.execute('Edit.Copy');
  assert.equal(editor.clipboardText, 'a\n');
  editor.goto(3);
  await editor.adapter.execute('Edit.Paste');
  assert.equal(editor.value, 'a\na\nb');
  editor.dispose();
});

test('denied and stale clipboard requests never mutate text, history or selections', async t => {
  for (const operation of ['Edit.Cut', 'Edit.Paste']) await t.test(operation, async () => {
    const editor = createNativeEditor('hello', { selections: [[0, 5]], clipboard: {
      readText: async () => { throw new Error('permission denied'); }, writeText: async () => { throw new Error('permission denied'); }
    } });
    await assert.rejects(editor.adapter.execute(operation), /permission denied/);
    assert.equal(editor.value, 'hello');
    assert.equal(editor.model.undoStack.depth, 0);
    assert.deepEqual(selectionPairs(editor), [[0, 5]]);
    editor.dispose();
  });
  for (const change of ['selection', 'document', 'dispose', 'profile', 'readonly']) await t.test(change, async () => {
    const pending = deferred();
    const editor = createNativeEditor('hello', { clipboard: { readText: () => pending.promise } });
    const paste = editor.adapter.execute('Edit.Paste');
    if (change === 'selection') editor.goto(2);
    if (change === 'document') editor.applyEdits([{ start: 0, end: 0, text: 'X' }], { undoStop: true });
    if (change === 'dispose') editor.dispose();
    if (change === 'profile') editor.adapter.setMode('emacs');
    if (change === 'readonly') editor.setReadOnly(true);
    const before = editor.value;
    const selections = selectionPairs(editor);
    const depth = editor.model.undoStack.depth;
    pending.resolve('PASTE');
    if (change === 'readonly') assert.equal(await paste, false);
    else await assert.rejects(paste, /changed|disposed/);
    assert.equal(editor.value, before);
    assert.deepEqual(selectionPairs(editor), selections);
    assert.equal(editor.model.undoStack.depth, depth);
    editor.dispose();
  });
});

test('CodeMirror protocol is a live model projection with operation undo and savepoint cleanliness', () => {
  const editor = createNativeEditor('one\ntwo');
  const cm = editor.adapter.cm;
  assert.equal(cm.getDoc(), cm);
  assert.equal(cm.getValue(), editor.value);
  const generation = cm.changeGeneration();
  cm.operation(() => {
    cm.replaceRange('ONE', { line: 0, ch: 0 }, { line: 0, ch: 3 });
    cm.replaceRange('TWO', { line: 1, ch: 0 }, { line: 1, ch: 3 });
  });
  assert.equal(cm.getValue(), 'ONE\nTWO');
  assert.deepEqual(cm.historySize(), { undo: 1, redo: 0 });
  assert.equal(cm.isClean(generation), false);
  cm.undo();
  assert.equal(cm.getValue(), 'one\ntwo');
  assert.equal(cm.isClean(generation), true);
  cm.redo();
  cm.markClean();
  assert.equal(cm.isClean(), true);
  editor.applyEdits([{ start: 0, end: 0, text: '!' }], { undoStop: true });
  assert.equal(cm.getValue(), '!ONE\nTWO');
  assert.equal(cm.isClean(), false);
  editor.undo();
  assert.equal(cm.isClean(), true);
  editor.dispose();
});

test('document marks follow edits, are cleared on model replacement, and dispose releases subscriptions', () => {
  const editor = createNativeEditor('abc\ndef');
  const cm = editor.adapter.cm;
  const mark = cm.markText({ line: 1, ch: 0 }, { line: 1, ch: 3 });
  editor.applyEdits([{ start: 0, end: 0, text: '++\n' }], { undoStop: true });
  assert.deepEqual(mark.find(), { from: { line: 2, ch: 0 }, to: { line: 2, ch: 3 } });
  editor.undo();
  assert.deepEqual(mark.find(), { from: { line: 1, ch: 0 }, to: { line: 1, ch: 3 } });
  editor.adapter.beforeModelChange();
  editor.model = new EditorModel('new model', { uri: 'file:///new.cs' });
  editor.uri = editor.model.uri;
  editor.adapter.setModel();
  assert.equal(cm.getValue(), 'new model');
  assert.equal(mark.find(), undefined);
  editor.adapter.execute('Edit.SelectAllOccurrences');
  assert.deepEqual(selectionPairs(editor), [[0, 3]]);
  editor.dispose();
  assert.equal(cm.state.sharpforgeEditor, null);
  assert.equal(editor.adapter.handle(keyboardEvent('Mod+A')), false);
  assert.equal(editor.adapter.execute('Edit.Delete'), false);
});
