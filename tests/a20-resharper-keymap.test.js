import assert from 'node:assert/strict';
import test from 'node:test';
import {EDITOR_KEYMAPS, getProfileBindings} from '@sharpforge/editor';
import {createNativeEditor, keyboardEvent, selectionPairs} from './support/native-editor-fixture.js';

test('ReSharper-like is a native profile with stable identity and preserves the Visual Studio default', () => {
  assert.equal(EDITOR_KEYMAPS[0].id, 'visual-studio');
  assert.equal(EDITOR_KEYMAPS.find(item => item.id === 'resharper').label, 'ReSharper-like (IntelliJ)');
  const editor = createNativeEditor('', {mode: 'resharper'});
  const bindings = getProfileBindings('resharper');
  assert.ok(Object.isFrozen(bindings));
  for (const binding of bindings) {
    assert.ok(Object.isFrozen(binding));
    assert.ok(editor.adapter.commands.has(binding.command), binding.command);
  }
  assert.equal(editor.adapter.bindings.resolve('Ctrl+P').binding.command, 'Edit.ParameterInfo');
  assert.equal(editor.adapter.bindings.resolve('F12').binding.command, 'Edit.GotoNextIssueinFile');
  assert.equal(editor.adapter.bindings.resolve('Ctrl+Y').binding.command, 'Edit.Redo');
  editor.dispose();
});

test('duplicate edits every selected range in one model transaction and undo restores primary direction', async () => {
  const text = 'one two\r\nthree four';
  const editor = createNativeEditor(text, {mode: 'resharper', selections: [[3, 0], [15, 19]], primaryIndex: 1});
  const before = selectionPairs(editor);
  await editor.press('Mod+D');
  assert.equal(editor.value, 'oneone two\r\nthree fourfour');
  assert.equal(editor.model.undoStack.depth, 1);
  assert.equal(editor.primaryIndex, 1);
  await editor.press('Mod+Z');
  assert.equal(editor.value, text);
  assert.deepEqual(selectionPairs(editor), before);
  assert.equal(editor.primaryIndex, 1);
  await editor.press('Mod+Y');
  assert.equal(editor.value, 'oneone two\r\nthree fourfour');
  editor.dispose();
});

test('line duplication and joining use native CRLF-aware commands', async () => {
  const editor = createNativeEditor('one\r\n  two', {mode: 'resharper', selections: [[1, 1]], options: {endOfLine: '\r\n'}});
  await editor.press('Mod+D');
  assert.equal(editor.value, 'one\r\none\r\n  two');
  await editor.press('Mod+Z');
  await editor.press('Mod+Shift+J');
  assert.equal(editor.value, 'one two');
  await editor.press('Mod+Z');
  assert.equal(editor.value, 'one\r\n  two');
  editor.dispose();
});

test('line and shifted-punctuation block comment shortcuts change the real model and remain reversible', async () => {
  const editor = createNativeEditor('a\r\nb', {mode: 'resharper', selections: [[0, 0], [3, 3]]});
  await editor.press('Mod+/');
  assert.equal(editor.value, '// a\r\n// b');
  assert.equal(editor.model.undoStack.depth, 1);
  await editor.press('Mod+/');
  assert.equal(editor.value, 'a\r\nb');
  editor.goto(0, editor.model.length);
  await editor.press('Mod+Shift+/');
  assert.equal(editor.value, '/*a\r\nb*/');
  editor.goto(0, editor.model.length);
  await editor.press('Mod+Shift+/');
  assert.equal(editor.value, 'a\r\nb');
  await editor.press('Mod+Z');
  assert.equal(editor.value, '/*a\r\nb*/');
  editor.dispose();
});

test('ReSharper move-line gestures preserve the original line terminators and undo history', async () => {
  const editor = createNativeEditor('a\r\nb\r\nc', {mode: 'resharper', selections: [[3, 3]], options: {endOfLine: '\r\n'}});
  await editor.press('Mod+Alt+Shift+ArrowUp');
  assert.equal(editor.value, 'b\r\na\r\nc');
  await editor.press('Mod+Alt+Shift+ArrowDown');
  assert.equal(editor.value, 'a\r\nb\r\nc');
  assert.equal(editor.model.undoStack.depth, 2);
  await editor.press('Mod+Z');
  assert.equal(editor.value, 'b\r\na\r\nc');
  editor.dispose();
});

const featureCases = [
  ['Alt+Enter', 'codeActions', []], ['Mod+Alt+L', 'format', [{}]],
  ['Mod+Space', 'complete', []], ['Mod+P', 'signatureHelp', []], ['Mod+Q', 'quickInfo', []],
  ['Mod+J', 'insertSnippet', []], ['Mod+Alt+J', 'surroundWith', []],
  ['Mod+W', 'expandSelection', []], ['Mod+Shift+W', 'shrinkSelection', []],
  ['F12', 'nextDiagnostic', [1]], ['Shift+F12', 'nextDiagnostic', [-1]],
  ['Mod+Shift+R', 'codeActions', []], ['F2', 'rename', []],
  ['Mod+K Mod+P', 'signatureHelp', []], ['Mod+K Mod+I', 'quickInfo', []],
  ['Mod+K Mod+W', 'expandSelection', []], ['Mod+K Mod+Shift+W', 'shrinkSelection', []]
];

test('language and selection gestures invoke the supported provider contract exactly once', async () => {
  const editor = createNativeEditor('value', {mode: 'resharper'});
  const initialVersion = editor.model.version;
  const calls = [];
  editor.features = Object.fromEntries(featureCases.map(([, method]) => [method, (...args) => calls.push({method, args})]));
  for (const [keys, method, args] of featureCases) {
    const count = calls.length;
    await editor.press(keys);
    assert.equal(calls.length, count + 1, keys);
    assert.deepEqual(calls.at(-1), {method, args}, keys);
  }
  assert.equal(editor.model.version, initialVersion);
  editor.dispose();
});

const hostCases = [
  ['Mod+N', 'navigateTo', {}], ['Mod+Shift+N', 'navigateTo', {query: 'f '}],
  ['Mod+Alt+Shift+N', 'navigateTo', {query: '# '}], ['Mod+F12', 'navigateTo', {query: 'm '}],
  ['Mod+E', 'navigateTo', {query: 'recent '}], ['Mod+B', 'definition', {}], ['Alt+F7', 'references', {}],
  ['Mod+Shift+A', 'commands', {}], ['Mod+Alt+M', 'codeActions', {kind: 'extractMethod'}],
  ['Mod+K Mod+N', 'navigateTo', {}], ['Mod+K Mod+F', 'navigateTo', {query: 'f '}],
  ['Mod+K Mod+S', 'navigateTo', {query: '# '}], ['Mod+K Mod+M', 'navigateTo', {query: 'm '}],
  ['Mod+K Mod+E', 'navigateTo', {query: 'recent '}], ['Mod+K Mod+,', 'settings', {}],
  ['Mod+K Mod+B', 'definition', {}]
];

test('navigation and browser-alternative chords preserve query arguments, URI and caret at the host seam', async () => {
  const editor = createNativeEditor('value', {mode: 'resharper', selections: [[2, 2]]});
  for (const [keys, command, parameters] of hostCases) {
    const count = editor.requests.length;
    await editor.press(keys);
    assert.equal(editor.requests.length, count + 1, keys);
    assert.deepEqual(editor.requests.at(-1), {command, params: {uri: editor.uri, offset: 2, ...parameters}}, keys);
  }
  assert.equal(editor.value, 'value');
  editor.dispose();
});

test('a language provider can complete formatting and rename through the same model and shared undo stack', async () => {
  const editor = createNativeEditor('int x=1;', {mode: 'resharper'});
  editor.features = {
    format: () => editor.applyEdits([{start: 5, end: 6, text: ' = '}], {undoStop: true, source: 'format'}),
    rename: () => editor.applyEdits([{start: 4, end: 5, text: 'answer'}], {undoStop: true, source: 'rename'})
  };
  await editor.press('Mod+Alt+L');
  assert.equal(editor.value, 'int x = 1;');
  await editor.press('F2');
  assert.equal(editor.value, 'int answer = 1;');
  await editor.press('Mod+Z');
  assert.equal(editor.value, 'int x = 1;');
  await editor.press('Mod+Z');
  assert.equal(editor.value, 'int x=1;');
  editor.dispose();
});

test('absent snippet providers report explicit unavailability and never edit the document', async () => {
  const editor = createNativeEditor('value', {mode: 'resharper'});
  await editor.press('Mod+J');
  await editor.press('Mod+Alt+J');
  assert.ok(editor.messages.some(message => /insertSnippet.*no provider/u.test(message)));
  assert.ok(editor.messages.some(message => /surroundWith.*no provider/u.test(message)));
  assert.equal(editor.value, 'value');
  assert.equal(editor.model.undoStack.depth, 0);
  editor.dispose();
});

test('read-only, composing, AltGraph and disposed views cannot perform ReSharper edits', async () => {
  const editor = createNativeEditor('value', {mode: 'resharper', selections: [[0, 5]]});
  editor.setReadOnly(true);
  for (const keys of ['Mod+D', 'Mod+/', 'Mod+Shift+/', 'Mod+Shift+J', 'Mod+Alt+L', 'F2', 'Mod+Alt+M']) {
    await editor.press(keys);
  }
  assert.equal(editor.value, 'value');
  assert.equal(editor.model.undoStack.depth, 0);
  assert.deepEqual(editor.requests, []);
  editor.setReadOnly(false);
  const composing = {...keyboardEvent('Mod+D'), isComposing: true};
  const altGraph = {...keyboardEvent('Mod+Alt+L'), getModifierState: key => key === 'AltGraph'};
  assert.equal(editor.adapter.handle(composing), false);
  assert.equal(editor.adapter.handle(altGraph), false);
  assert.equal(composing.defaultPrevented, false);
  assert.equal(altGraph.defaultPrevented, false);
  editor.dispose();
  assert.equal(editor.adapter.handle(keyboardEvent('Mod+D')), false);
  assert.equal(editor.value, 'value');
});

test('the portable Mac mapping uses Meta and retains browser chord alternatives', async () => {
  const editor = createNativeEditor('a', {mode: 'resharper', platform: 'mac', selections: [[0, 1]]});
  await editor.press('Mod+D');
  assert.equal(editor.value, 'aa');
  await editor.press('Mod+K Mod+N');
  assert.equal(editor.requests.at(-1).command, 'navigateTo');
  assert.equal(editor.adapter.handle(keyboardEvent('Ctrl+D', 'mac')), false);
  editor.dispose();
});

test('profile switches preserve model identity, undo, selections, folds, bookmarks and modal state', async () => {
  const editor = createNativeEditor('a\nb\nc', {mode: 'visual-studio', selections: [[1, 1]]});
  editor.insertText('!', {undoStop: true});
  editor.setSelections([{anchor: 0, active: 2}, {anchor: 4, active: 4}], {primaryIndex: 1});
  editor.folding.setRanges([{startLine: 0, endLine: 2, collapsed: true}], editor.model.lineCount);
  editor.bookmarks.toggle(2);
  editor.adapter.emacs.push('kept');
  editor.adapter.vim.registers.write('a', 'register');
  const model = editor.model;
  const before = {text: editor.value, version: model.version, selections: selectionPairs(editor), depth: model.undoStack.depth};
  for (const mode of ['resharper', 'vscode', 'vim', 'emacs', 'resharper', 'visual-studio']) {
    editor.adapter.setMode(mode);
    assert.equal(editor.model, model);
    assert.deepEqual({text: editor.value, version: model.version, selections: selectionPairs(editor), depth: model.undoStack.depth}, before);
    assert.equal(editor.primaryIndex, 1);
    assert.equal(editor.folding.hidden(1), true);
    assert.equal(editor.bookmarks.has(2), true);
    assert.equal(editor.adapter.emacs.ring[0], 'kept');
    assert.equal((await editor.adapter.vim.registers.read('a')).text, 'register');
  }
  assert.throws(() => editor.adapter.setMode('resharper-unknown'), /Unknown editor profile/u);
  assert.equal(editor.keymap, 'visual-studio');
  editor.adapter.setMode('resharper');
  await editor.press('Mod+Z');
  assert.equal(editor.value, 'a\nb\nc');
  editor.dispose();
});
