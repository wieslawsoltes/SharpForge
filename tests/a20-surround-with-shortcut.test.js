import test from 'node:test';
import assert from 'node:assert/strict';
import { SnippetSession } from '../packages/editor/src/snippets/session.js';
import { createNativeEditor, keyboardEvent } from './support/native-editor-fixture.js';

test('B01: Visual Studio Ctrl+K Ctrl+S reaches Surround With once and applies a production snippet in one undo', async () => {
  const editor = createNativeEditor('Work();', { mode: 'visual-studio', selections: [[0, 7]] });
  const session = Object.create(SnippetSession.prototype);
  session.context = { editor };
  session.popup = { close() {} };
  let surroundCalls = 0;
  let codeActionCalls = 0;
  editor.insights = {
    surroundWith() {
      surroundCalls++;
      return session.insert('if (${1:condition}) {\n\t$TM_SELECTED_TEXT\n}$0', { start: 0, end: 7 });
    },
    codeActions() { codeActionCalls++; }
  };
  assert.equal(editor.adapter.handle(keyboardEvent('Ctrl+K')), true);
  assert.equal(surroundCalls, 0, 'The first stroke waits for the second stroke');
  await editor.press('Ctrl+S');
  assert.equal(surroundCalls, 1);
  assert.equal(codeActionCalls, 0);
  assert.equal(editor.value, 'if (condition) {\n\tWork();\n}');
  assert.equal(editor.model.undoStack.depth, 1);
  assert.deepEqual(editor.requests, []);
  editor.model.undo();
  assert.equal(editor.value, 'Work();');
  editor.dispose();
});

test('B01: a missing Surround With provider reports its absence without opening code actions', async () => {
  const editor = createNativeEditor('Work();', { mode: 'visual-studio', selections: [[0, 7]] });
  let codeActionCalls = 0;
  editor.insights = { codeActions() { codeActionCalls++; } };
  await editor.press('Ctrl+K Ctrl+S');
  assert.match(editor.messages.at(-1), /surroundWith.*no provider/i);
  assert.equal(codeActionCalls, 0);
  assert.equal(editor.value, 'Work();');
  assert.equal(editor.model.undoStack.depth, 0);
  assert.deepEqual(editor.requests, []);
  editor.dispose();
});
