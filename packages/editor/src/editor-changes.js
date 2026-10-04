/** Publishes one native text revision without repeating decoration DOM work inside its synchronous callbacks. */
export function publishEditorChange(editor, record = true) {
  // Chromium can deliver several input events exposing one final multiline replacement.
  // Duplicate text must not create another source revision or undo record.
  const text = editor.value;
  if (text === editor.previous) return;
  const now = performance.now();
  if (record && (now - editor.lastEdit > 450 || !editor.history.length)) editor.record();
  editor.lastEdit = now;
  editor.previous = editor.value;
  editor.keymapAdapter?.syncFromBridge();
  updateEditor(editor);
  if (!editor.completion.classList.contains('hidden')) editor.complete();
}

/** Restores the existing per-model history, then publishes its source and decorations synchronously. */
export function restoreEditorChange(editor, redo = false) {
  if (editor.input.readOnly) return;
  if (editor.keymapAdapter) {
    editor.keymapAdapter.undo(redo);
    return;
  }
  const from = redo ? editor.future : editor.history;
  const to = redo ? editor.history : editor.future;
  const item = from.pop();
  if (!item) return;
  to.push({text: editor.value, start: editor.input.selectionStart, end: editor.input.selectionEnd});
  editor.input.value = item.text;
  editor.input.setSelectionRange(item.start, item.end);
  editor.previous = editor.value;
  editor.lastEdit = 0;
  updateEditor(editor);
}

function updateEditor(editor) {
  editor.rendering.batch(() => {
    try {
      editor.onChange(editor.value);
    } finally {
      editor.paint();
    }
    editor.cursor();
  });
}
