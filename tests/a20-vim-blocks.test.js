import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeEditor, selectionPairs } from './support/native-editor-fixture.js';

const vimEditor = (text, options = {}) => createNativeEditor(text, { mode: 'vim', ...options });

test('Vim block deletion uses display columns across partial tabs, wide graphemes, combining text and short lines', async () => {
  const original = 'abcd\n\tZ\n界éx\n👩‍💻AB\nx';
  const editor = vimEditor(original, { selections: [[2, 2]] });
  await editor.feed(['Ctrl+v', '4', 'j']);
  assert.deepEqual(editor.getSelections().map(selection => [selection.box.startColumn, selection.box.endColumn]),
    Array.from({ length: 5 }, () => [2, 3]));
  const selected = selectionPairs(editor);
  await editor.feed('d');
  assert.equal(editor.value, 'abd\n   Z\n界x\n👩‍💻B\nx');
  const register = await editor.adapter.vim.registers.read();
  assert.deepEqual(register.block.fragments, ['c', ' ', 'é', 'A', ' ']);
  assert.equal(register.block.width, 1);
  assert.equal(editor.value.isWellFormed(), true);
  assert.equal(editor.model.undoStack.depth, 1);
  editor.undo();
  assert.equal(editor.value, original);
  assert.deepEqual(selectionPairs(editor), selected);
  editor.dispose();
});

test('Vim block change types on every selected row and retains virtual space in one history group', async () => {
  const original = 'abcd\n\tZ\n界éx\n👩‍💻AB\nx';
  const editor = vimEditor(original, { selections: [[2, 2]] });
  await editor.feed(['Ctrl+v', '4', 'j', 'c']);
  assert.equal(editor.getSelections().length, 5);
  await editor.feed(['Q', 'R', 'Escape']);
  assert.equal(editor.value, 'abQRd\n  QR Z\n界QRx\n👩‍💻QRB\nx QR');
  assert.equal(editor.adapter.vim.mode, 'normal');
  assert.equal(editor.model.undoStack.depth, 1);
  editor.undo();
  assert.equal(editor.value, original);
  editor.dispose();
});

test('Vim block insert, append and end-of-line append honor their distinct short-line behavior', async t => {
  for (const fixture of [
    { keys: ['I', '!', 'Escape'], after: 'ab!cd\nx\n  !  Z' },
    { keys: ['A', '!', 'Escape'], after: 'abc!d\nx  !\n   ! Z' },
    { keys: ['$', 'A', '!', 'Escape'], after: 'abcd!\nx!\n\tZ!' },
    { keys: ['D'], after: 'ab\nx\n  ' },
    { keys: ['C', '!', 'Escape'], after: 'ab!\nx !\n  !' }
  ]) await t.test(fixture.keys.join(' '), async () => {
    const editor = vimEditor('abcd\nx\n\tZ', { selections: [[2, 2]] });
    await editor.feed(['Ctrl+v', '2', 'j', ...fixture.keys]);
    assert.equal(editor.value, fixture.after);
    assert.equal(editor.model.undoStack.depth, 1);
    editor.undo();
    assert.equal(editor.value, 'abcd\nx\n\tZ');
    editor.dispose();
  });
});

test('Vim block registers preserve rows on counted normal puts, visual puts and puts beyond the final line', async () => {
  const editor = vimEditor('ab\ncd\nx');
  await editor.feed(['Ctrl+v', 'j', '"', 'a', 'y']);
  assert.deepEqual((await editor.adapter.vim.registers.read('a')).block, { fragments: ['a', 'c'], width: 1 });
  await editor.feed(['"', 'a', '2', 'p']);
  assert.equal(editor.value, 'aaab\ncccd\nx');
  editor.undo();
  editor.goto(6);
  await editor.feed(['"', 'a', 'p']);
  assert.equal(editor.value, 'ab\ncd\nxa\n c');
  editor.undo();
  editor.goto(1);
  await editor.feed(['Ctrl+v', 'j', '"', 'a', 'p']);
  assert.equal(editor.value, 'aa\ncc\nx');
  assert.equal(editor.adapter.vim.mode, 'normal');
  editor.dispose();
});

test('Vim asynchronous clipboard keeps block metadata only while clipboard text still matches', async () => {
  const editor = vimEditor('ab\ncd');
  await editor.feed(['Ctrl+v', 'j', '"', '+', 'y']);
  assert.equal(editor.clipboardText, 'a\nc');
  assert.deepEqual((await editor.adapter.vim.registers.read('+')).block.fragments, ['a', 'c']);
  await editor.feed(['"', '+', 'p']);
  assert.equal(editor.value, 'aab\nccd');
  editor.clipboardText = 'plain';
  assert.deepEqual(await editor.adapter.vim.registers.read('+'), { text: 'plain', linewise: false });
  editor.dispose();
});

test('Vim visual replacement splits tabs and fills virtual cells without splitting surrogate pairs', async () => {
  const editor = vimEditor('abcd\n\tZ\nx', { selections: [[1, 1]] });
  await editor.feed(['Ctrl+v', 'l', '2', 'j', 'r', '#']);
  assert.equal(editor.value, 'a##d\n ## Z\nx##');
  assert.equal(editor.model.undoStack.depth, 1);
  editor.undo();
  assert.equal(editor.value, 'abcd\n\tZ\nx');
  editor.dispose();
  const wide = vimEditor('abcd\n界éx\n😀ab', { selections: [[1, 1]] });
  await wide.feed(['Ctrl+v', 'l', '2', 'j', 'd']);
  assert.equal(wide.value, 'ad\nx\nb');
  assert.equal(wide.value.isWellFormed(), true);
  wide.dispose();
});

test('Vim block shifts use the left boundary, count, shift width and tab policy', async t => {
  for (const fixture of [
    { text: 'abCD\n\tX\nx', keys: ['2', '>'], after: 'ab    CD\n        X\nx', insertSpaces: true },
    { text: 'ab    CD\n\t X\nx', keys: ['<'], after: 'ab  CD\n   X\nx', insertSpaces: true },
    { text: 'abCD\n\tX\nx', keys: ['2', '>'], after: 'ab\t  CD\n\t\tX\nx', insertSpaces: false }
  ]) await t.test(fixture.keys.join(' ') + ' spaces=' + fixture.insertSpaces, async () => {
    const editor = vimEditor(fixture.text, {
      selections: [[2, 2]], options: { tabSize: 4, indentSize: 2, insertSpaces: fixture.insertSpaces }
    });
    await editor.feed(['Ctrl+v', '2', 'j', ...fixture.keys]);
    assert.equal(editor.value, fixture.after);
    assert.equal(editor.model.undoStack.depth, 1);
    editor.undo();
    assert.equal(editor.value, fixture.text);
    editor.dispose();
  });
});

test('Vim normal vertical moves preserve display column and block corner switches preserve the selected rectangle', async () => {
  const editor = vimEditor('ab界c\n\tq\nabcdef', { selections: [[3, 3]] });
  await editor.feed('j');
  assert.equal(editor.caretOffset, 6);
  await editor.feed('j');
  assert.equal(editor.caretOffset, 12);
  editor.dispose();
  const block = vimEditor('abcd\nabcd', { selections: [[1, 1]] });
  await block.feed(['Ctrl+v', 'l', 'j']);
  const before = block.getSelections().map(({ start, end }) => [start, end]);
  await block.feed('O');
  assert.deepEqual(block.getSelections().map(({ start, end }) => [start, end]), before);
  await block.feed(['Escape']);
  assert.equal(block.caretOffset, 6);
  block.dispose();
});

test('Vim visual aliases operate on the selected text rather than normal-mode single-character ranges', async t => {
  for (const [key, after] of [['x', 'ad'], ['U', 'aBCd'], ['u', 'abcd'], ['~', 'aBCd'], ['r#', 'a##d']]) {
    await t.test(key, async () => {
      const text = key === 'u' ? 'aBCd' : 'abcd';
      const editor = vimEditor(text, { selections: [[1, 1]] });
      await editor.feed(['v', 'l', ...key]);
      assert.equal(editor.value, after);
      assert.equal(editor.model.undoStack.depth, 1);
      editor.undo();
      assert.equal(editor.value, text);
      editor.dispose();
    });
  }
});

test('Vim block edits reject malformed metadata, excessive virtual replacement and locked models before mutation', async () => {
  const editor = vimEditor('abcd\n\tZ', { selections: [[1, 1]] });
  assert.throws(() => editor.adapter.vim.registers.write('a', 'x', { block: { fragments: ['different'], width: 1 } }), /fragments/);
  await editor.feed(['Ctrl+v', 'l', 'j']);
  editor.adapter.vim.registers.maxCharacters = 3;
  await assert.rejects(editor.feed(['r', '#']), /budget/);
  assert.equal(editor.value, 'abcd\n\tZ');
  assert.equal(editor.model.undoStack.depth, 0);
  editor.adapter.vim.registers.maxCharacters = 1000;
  editor.setReadOnly(true);
  await editor.feed('d');
  assert.equal(editor.value, 'abcd\n\tZ');
  assert.equal(editor.model.undoStack.depth, 0);
  editor.dispose();
});
