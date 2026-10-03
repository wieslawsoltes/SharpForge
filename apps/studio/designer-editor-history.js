/** Menu and command undo follow the same atomic designer boundary as keyboard undo. */
export function undoSourceEditor(context, redo = false, editor = context.editor) {
  if (context.undoSource) return context.undoSource(editor?.uri ?? context.state.active, redo);
  return editor?.undo(redo);
}
