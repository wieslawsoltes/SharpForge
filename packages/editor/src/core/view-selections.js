import {transformSelections} from '../selections.js';

/** Prepare view-owned selections before document-owner callbacks can refocus or capture the input. */
export function updateViewSelections(editor, change) {
  const sequence = change.historyEvents;
  const snapshot = sequence?.at(-1).after ?? change.after;
  const prepared = editor.selectionSnapshots ??= new WeakSet();
  if (prepared.has(snapshot)) return;
  if (editor.applying) {
    editor.selections = editor.model.selections.map(selection => ({...selection}));
    editor.primaryIndex = editor.model.primaryIndex;
  } else {
    // Grouped undo has committed every snapshot before its first notification.
    // Transform an independent view through the complete sequence exactly once.
    for (const event of sequence ?? [change]) {
      const transformed = transformSelections(editor.selections, event.changes, event.after.length, editor.primaryIndex);
      editor.selections = transformed.selections;
      editor.primaryIndex = transformed.primaryIndex;
    }
  }
  prepared.add(snapshot);
}

/** Buffer publication precedes model-owner publication; rendering remains in the normal model listener. */
export function subscribeViewSelections(editor) {
  const model = editor.model;
  editor.selectionSnapshots = new WeakSet([model.snapshot()]);
  return model.buffer.onDidChange(change => {
    if (editor.disposed || editor.model !== model) return;
    updateViewSelections(editor, change);
  });
}
