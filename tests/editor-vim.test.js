import assert from 'node:assert/strict';
import test from 'node:test';
import { SearchLimitError } from '../packages/text/src/search.js';
import { createNativeEditor, deferred, keyboardEvent, selectionPairs } from './support/native-editor-fixture.js';

const vimEditor = (text, options = {}) => createNativeEditor(text, { mode: 'vim', ...options });

test('Vim counts multiply operators, motions and line ranges and each edit undoes as one operation', async t => {
  for (const fixture of [
    { text: 'one two three four five', keys: '2d2w', after: 'five' },
    { text: 'one\ntwo\nthree', keys: '2dd', after: 'three' },
    { text: 'one\ntwo\nthree', keys: 'Gdd', after: 'one\ntwo' },
    { text: 'one two', keys: 'de', after: ' two' },
    { text: 'one two', keys: 'dw', after: 'two' },
    { text: 'one two', keys: 'D', after: '' },
    { text: 'one\ntwo', keys: 'J', after: 'one two' },
    { text: 'one\n  two', keys: 'gJ', after: 'one  two' }
  ]) await t.test(fixture.keys, async () => {
    const editor = vimEditor(fixture.text);
    await editor.feed(fixture.keys);
    assert.equal(editor.value, fixture.after);
    assert.equal(editor.model.undoStack.depth, 1);
    await editor.feed('u');
    assert.equal(editor.value, fixture.text);
    await editor.feed(['Ctrl+r']);
    assert.equal(editor.value, fixture.after);
    editor.dispose();
  });
});

test('Vim normal movements, finds and character deletes stay at grapheme and CRLF line boundaries', async () => {
  const editor = vimEditor('A👩‍💻B\r\nC');
  await editor.feed('2l');
  assert.equal(editor.caretOffset, 6);
  await editor.feed('99l');
  assert.equal(editor.caretOffset, 6);
  await editor.feed('x');
  assert.equal(editor.value, 'A👩‍💻\r\nC');
  assert.equal(editor.caretOffset, 1);
  await editor.feed('j');
  assert.equal(editor.caretOffset, 8);
  await editor.feed('X');
  assert.equal(editor.value, 'A👩‍💻\r\nC');
  editor.dispose();
  const word = vimEditor('𐐀𐐁 cat');
  await word.feed('e');
  assert.equal(word.caretOffset, 2);
  await word.feed('w');
  assert.equal(word.caretOffset, 5);
  await word.feed('b');
  assert.equal(word.caretOffset, 0);
  await word.feed('diw');
  assert.equal(word.value, ' cat');
  word.dispose();
  const limited = vimEditor('ab\ncd', { selections: [[1, 1]] });
  await limited.feed('9x');
  assert.equal(limited.value, 'a\ncd');
  assert.equal(limited.caretOffset, 0);
  limited.dispose();
});

test('Vim word-end, backward-end, find/till, paragraph, line and document motions have expected offsets', async t => {
  for (const [text, start, keys, expected] of [
    ['one two three', 0, '2w', 8], ['one two three', 8, 'ge', 6], ['one two three', 8, '2ge', 2],
    ['one two three', 0, '2e', 6], ['one.two three', 0, 'W', 8],
    ['abc abc', 0, 'fc', 2], ['abc abc', 0, 'tc', 1], ['abc abc', 6, 'Fa', 4],
    ['A😀BC', 0, 'tB', 1], ['one\n\ntwo', 0, '}', 4],
    ['one\n  two\nthree', 5, '^', 6], ['one\n  two\nthree', 6, '0', 4],
    ['one\n  two\nthree', 0, 'G', 10], ['one\n  two\nthree', 12, 'gg', 0],
    ['one\n  two\nthree', 0, '2G', 4]
  ]) await t.test(keys + ' at ' + start, async () => {
    const editor = vimEditor(text, { selections: [[start, start]] });
    await editor.feed(keys);
    assert.equal(editor.caretOffset, expected);
    assert.equal(editor.value, text);
    assert.equal(editor.model.undoStack.depth, 0);
    editor.dispose();
  });
});

test('Vim change, insert, replace and open-line sessions share one explicit history group', async t => {
  for (const fixture of [
    { text: 'one two', keys: ['c', 'w', 'N', 'E', 'W', 'Escape'], after: 'NEW two', point: 2 },
    { text: '', keys: ['i', 'a', 'b', 'c', 'Escape'], after: 'abc', point: 2 },
    { text: 'abc', keys: ['R', 'X', 'Y', 'Escape'], after: 'XYc', point: 1 },
    { text: 'abc', keys: ['r', '😀'], after: '😀bc', point: 0 },
    { text: 'a\r\nb', keys: ['o', 'X', 'Escape'], after: 'a\r\nX\r\nb', point: 3, options: { endOfLine: '\r\n' } },
    { text: '  a', keys: ['O', 'X', 'Escape'], after: '  X\n  a', point: 2 },
    { text: 'one', keys: ['c', 'c', 'X', 'Escape'], after: 'X', point: 0 }
  ]) await t.test(fixture.keys.join(' '), async () => {
    const editor = vimEditor(fixture.text, fixture);
    await editor.feed(fixture.keys);
    assert.equal(editor.value, fixture.after);
    assert.equal(editor.caretOffset, fixture.point);
    assert.equal(editor.adapter.vim.mode, 'normal');
    assert.equal(editor.model.undoStack.depth, 1);
    editor.undo();
    assert.equal(editor.value, fixture.text);
    editor.dispose();
  });
});

test('Vim text objects use half-open word, quote, nested bracket, sentence and paragraph ranges', async t => {
  for (const fixture of [
    { text: 'one two', start: 1, keys: 'diw', after: ' two' },
    { text: 'one two', start: 1, keys: 'daw', after: 'two' },
    { text: 'say "hello" now', start: 7, keys: 'di"', after: 'say "" now' },
    { text: '{ one (two) }', start: 8, keys: 'di(', after: '{ one () }', pairs: [[0, 12], [12, 0], [6, 10], [10, 6]] },
    { text: '((two))', start: 3, keys: '2da(', after: '', pairs: [[0, 6], [6, 0], [1, 5], [5, 1]] },
    { text: 'One. Two.', start: 6, keys: 'dis', after: 'One. ' },
    { text: 'one\ntwo\n\nthree', start: 2, keys: 'dip', after: '\nthree' }
  ]) await t.test(fixture.keys, async () => {
    const editor = vimEditor(fixture.text, { selections: [[fixture.start, fixture.start]], pairs: fixture.pairs });
    await editor.feed(fixture.keys);
    assert.equal(editor.value, fixture.after);
    editor.undo();
    assert.equal(editor.value, fixture.text);
    editor.dispose();
  });
});

test('Vim visual character, line and block operators edit the real multi-selection model', async () => {
  const character = vimEditor('abcd', { selections: [[1, 1]] });
  await character.feed('vl');
  assert.deepEqual(selectionPairs(character), [[1, 3]]);
  await character.feed('d');
  assert.equal(character.value, 'ad');
  assert.equal(character.adapter.vim.mode, 'normal');
  character.dispose();
  const line = vimEditor('one\ntwo\nthree');
  await line.feed('Vjy');
  assert.deepEqual(await line.adapter.vim.registers.read(), { text: 'one\ntwo\n', linewise: true });
  assert.equal(line.value, 'one\ntwo\nthree');
  line.dispose();
  const block = vimEditor('abcd\nabcd', { selections: [[1, 1]] });
  await block.feed(['Ctrl+v', 'l', 'j']);
  assert.deepEqual(selectionPairs(block), [[1, 3], [6, 8]]);
  await block.feed('d');
  assert.equal(block.value, 'ad\nad');
  assert.equal(block.model.undoStack.depth, 1);
  block.undo();
  assert.equal(block.value, 'abcd\nabcd');
  block.dispose();
});

test('Vim visual put replaces the selected range instead of inserting beside it', async () => {
  const editor = vimEditor('abcd', { selections: [[1, 1]] });
  editor.adapter.vim.registers.write('a', 'XY');
  await editor.feed(['v', 'l', '"', 'a', 'p']);
  assert.equal(editor.value, 'aXYd');
  assert.equal(editor.adapter.vim.mode, 'normal');
  assert.equal(editor.model.undoStack.depth, 1);
  editor.dispose();
});

test('Vim indent, case operators, matching pairs and repeated find use their native command ranges', async () => {
  const editor = vimEditor('one\ntwo');
  await editor.feed('>>');
  assert.equal(editor.value, '    one\ntwo');
  await editor.feed('<<');
  assert.equal(editor.value, 'one\ntwo');
  await editor.feed('gUiw');
  assert.equal(editor.value, 'ONE\ntwo');
  await editor.feed('guiw');
  assert.equal(editor.value, 'one\ntwo');
  await editor.feed('g~iw');
  assert.equal(editor.value, 'ONE\ntwo');
  editor.dispose();
  const pairs = vimEditor('(a(b)c)', { pairs: [[0, 6], [6, 0], [2, 4], [4, 2]] });
  await pairs.feed('%');
  assert.equal(pairs.caretOffset, 6);
  await pairs.feed('%');
  assert.equal(pairs.caretOffset, 0);
  pairs.dispose();
  const find = vimEditor('a.b.c');
  await find.feed('f.;');
  assert.equal(find.caretOffset, 3);
  await find.feed(',');
  assert.equal(find.caretOffset, 1);
  find.dispose();
});

test('Vim named, appended, yank, numbered and black-hole registers preserve their contracts', async () => {
  const editor = vimEditor('one\ntwo');
  await editor.feed(['"', 'a', 'y', 'y']);
  assert.deepEqual(await editor.adapter.vim.registers.read('a'), { text: 'one\n', linewise: true });
  assert.deepEqual(await editor.adapter.vim.registers.read('0'), { text: 'one\n', linewise: true });
  await editor.feed(['j', '"', 'A', 'y', 'y']);
  assert.equal((await editor.adapter.vim.registers.read('a')).text, 'one\ntwo\n');
  await editor.feed(['"', '_', 'd', 'd']);
  assert.equal(editor.value, 'one');
  assert.equal((await editor.adapter.vim.registers.read('a')).text, 'one\ntwo\n');
  await editor.feed('dd');
  assert.equal((await editor.adapter.vim.registers.read('1')).text, 'one\n');
  editor.adapter.vim.registers.maxCharacters = 3;
  assert.throws(() => editor.adapter.vim.registers.write('b', 'four'), /budget/);
  editor.dispose();
});

test('Vim marks track buffer edits, retain profile state and route cross-document jumps through the host', async () => {
  const editor = vimEditor('abc\ndef', { selections: [[5, 5]] });
  await editor.feed('ma');
  editor.applyEdits([{ start: 0, end: 0, text: '++' }], { undoStop: true });
  assert.equal(editor.adapter.vim.marks.get('a').offset, 7);
  editor.goto(0);
  await editor.feed('`a');
  assert.equal(editor.caretOffset, 7);
  editor.adapter.setMode('vscode');
  editor.adapter.setMode('vim');
  await editor.feed("'a");
  assert.equal(editor.caretOffset, 6);
  editor.adapter.vim.marks.set('B', { uri: 'file:///elsewhere.cs', offset: 10 });
  await editor.feed('`B');
  assert.deepEqual(editor.requests.at(-1), { command: 'openDocument', params: {
    uri: editor.uri, offset: 10, path: 'file:///elsewhere.cs'
  } });
  editor.dispose();
});

test('Vim macros, repeated changes and insertion replay use one undo group per replay', async () => {
  const editor = vimEditor('abcdef');
  await editor.feed('qaxlq');
  assert.deepEqual(editor.adapter.vim.registers.macros.get('a'), ['x', 'l']);
  assert.equal(editor.value, 'bcdef');
  await editor.feed('2@a');
  assert.equal(editor.value, 'bdf');
  editor.undo();
  assert.equal(editor.value, 'bcdef');
  editor.dispose();
  const repeat = vimEditor('ab');
  await repeat.feed(['i', 'X', 'Escape', 'l', '.']);
  assert.equal(repeat.value, 'XXab');
  assert.equal(repeat.model.undoStack.depth, 2);
  repeat.undo();
  assert.equal(repeat.value, 'Xab');
  repeat.adapter.vim.registers.setMacro('a', ['@', 'a']);
  await assert.rejects(repeat.feed('@a'), /recursion/);
  assert.equal(repeat.adapter.vim.replayDepth, 0);
  repeat.dispose();
});

test('Vim search uses bounded regex with wraparound, counts and reverse direction', async () => {
  const editor = vimEditor('cat dog cat cat');
  editor.adapter.vim.searchPattern('cat');
  assert.equal(editor.caretOffset, 8);
  await editor.feed('n');
  assert.equal(editor.caretOffset, 12);
  await editor.feed('n');
  assert.equal(editor.caretOffset, 0);
  await editor.feed('N');
  assert.equal(editor.caretOffset, 12);
  editor.dispose();
  const limited = vimEditor('a'.repeat(2000) + '!');
  assert.throws(() => limited.adapter.vim.searchPattern('(a+)+$'), SearchLimitError);
  assert.equal(limited.model.undoStack.depth, 0);
  limited.dispose();
});

test('Ex substitution captures, line scopes, flags and bounded failures are atomic', async () => {
  const editor = vimEditor('foo1 foo2\nfoo3');
  assert.equal(await editor.adapter.vim.ex.execute(':%s/foo([0-9])/bar\\1/g'), 3);
  assert.equal(editor.value, 'bar1 bar2\nbar3');
  assert.equal(editor.model.undoStack.depth, 1);
  editor.undo();
  assert.equal(editor.value, 'foo1 foo2\nfoo3');
  assert.equal(await editor.adapter.vim.ex.execute(':s/foo/FOO/'), 1);
  assert.equal(editor.value, 'FOO1 foo2\nfoo3');
  await editor.adapter.vim.ex.execute(':set ignorecase');
  assert.equal(await editor.adapter.vim.ex.execute(':%s/foo/X/gn'), 3);
  assert.equal(editor.value, 'FOO1 foo2\nfoo3');
  await assert.rejects(editor.adapter.vim.ex.execute(':%s/(/x/g'), /Unclosed|Unterminated|Expected|Invalid/);
  assert.equal(editor.value, 'FOO1 foo2\nfoo3');
  editor.dispose();
});

test('Ex settings and workspace requests use the common host and honor failed saves', async () => {
  const editor = vimEditor('one');
  await editor.adapter.vim.ex.execute(':set ts=8 sw=2 noexpandtab wrap');
  assert.equal(editor.options.tabSize, 8);
  assert.equal(editor.options.indentSize, 2);
  assert.equal(editor.options.insertSpaces, false);
  assert.equal(editor.options.wordWrap, true);
  await editor.adapter.vim.ex.execute(':wq');
  assert.deepEqual(editor.requests.map(request => request.command), ['save', 'closeDocument']);
  await editor.adapter.vim.ex.execute(':e next.cs');
  assert.equal(editor.requests.at(-1).params.path, 'next.cs');
  await assert.rejects(editor.adapter.vim.ex.execute(':set shell=/bin/sh'), /Unsupported/);
  editor.dispose();
  const requests = [];
  const failed = vimEditor('one', { requestHost: command => { requests.push(command); return false; } });
  await failed.adapter.vim.ex.execute(':wq');
  assert.deepEqual(requests, ['save']);
  failed.dispose();
});

test('Vim denied system-register delete and paste leave the model unchanged', async () => {
  const editor = vimEditor('hello', { clipboard: {
    readText: async () => { throw new Error('permission denied'); },
    writeText: async () => { throw new Error('permission denied'); }
  } });
  await assert.rejects(editor.feed(['"', '+', 'd', 'w']), /permission denied/);
  assert.equal(editor.value, 'hello');
  assert.equal(editor.model.undoStack.depth, 0);
  editor.adapter.vim.resetPending();
  await assert.rejects(editor.feed(['"', '+', 'p']), /permission denied/);
  assert.equal(editor.value, 'hello');
  editor.dispose();
});

test('Vim delayed clipboard and prompt responses reject stale or disposed editor state', async () => {
  const clipboard = deferred();
  const editor = vimEditor('hello', { clipboard: { readText: () => clipboard.promise } });
  const paste = editor.feed(['"', '+', 'p']);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  editor.goto(2);
  clipboard.resolve('PASTE');
  await assert.rejects(paste, /changed/);
  assert.equal(editor.value, 'hello');
  editor.dispose();
  const prompt = deferred();
  const disposed = vimEditor('hello', { prompt: () => prompt.promise });
  const command = disposed.adapter.vim.openPrompt(':');
  disposed.dispose();
  prompt.resolve('%s/hello/goodbye/g');
  await assert.rejects(command, /disposed/);
  assert.equal(disposed.value, 'hello');
});

test('Vim read-only mode and browser composition preserve the text and undo state', async () => {
  const editor = vimEditor('hello');
  editor.adapter.vim.registers.write('a', 'PASTE');
  editor.setReadOnly(true);
  for (const keys of ['x', 'dd', 'cw', 'i', 'R', '>>']) {
    await editor.feed(keys);
    assert.equal(editor.value, 'hello');
    assert.equal(editor.adapter.vim.mode, 'normal');
    editor.adapter.vim.resetPending();
  }
  await editor.feed(['"', 'a', 'p']);
  assert.equal(await editor.adapter.vim.ex.execute(':%s/hello/x/'), false);
  assert.equal(editor.value, 'hello');
  assert.equal(editor.model.undoStack.depth, 0);
  assert.equal(editor.adapter.handle({ ...keyboardEvent('X'), isComposing: true }), false);
  assert.equal(editor.adapter.handle({ ...keyboardEvent('Ctrl+Alt+E'), getModifierState: key => key === 'AltGraph' }), false);
  editor.dispose();
  assert.equal(editor.adapter.vim.feed('x'), false);
});

for (const [feature, reason] of [
  ['shell commands and external filters', 'The browser editor has no shell or process-execution authority.'],
  ['Vimscript and plugin loading', 'The native modal adapter is not a Vimscript interpreter or plugin runtime.'],
  ['terminal buffers', 'Terminal emulation is outside the editor document and keymap scope.'],
  ['native Vim regex extensions', 'Search uses the documented bounded regex engine rather than Vim magic expressions.'],
  ['operating-system primary selection', 'The injected asynchronous clipboard API exposes ordinary clipboard text.'],
  ['unlimited recursive macros', 'Native macros have explicit recursion, key-count and register-memory budgets.'],
  ['desktop Vim executable parity', 'Node fixtures qualify this native model; no installed desktop Vim is used as an oracle.'],
  ['browser key interception and assistive technology', 'Operating-system/browser key delivery and screen readers need browser/manual qualification.']
]) test(`Unsupported target: ${feature}`, { skip: reason }, () => {});
