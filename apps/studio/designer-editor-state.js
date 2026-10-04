/** Capture a view's logical scroll and every caret without retaining the editor or its source buffer. */
export function captureDesignerEditorView(editor) {
  if (!editor) return null;
  return {
    selections: editor.getSelections(), primaryIndex: editor.primaryIndex, version: editor.model.version,
    top: editor.view.scrollTop, left: editor.view.viewport.scrollLeft
  };
}

/** Restore through the public view API; it clamps selections and scroll to the current document. */
export function restoreDesignerEditorView(editor, state) {
  if (!editor || !state) return;
  editor.setSelections(state.selections, {primaryIndex: state.primaryIndex});
  editor.view.scrollTo({top: state.top, left: state.left});
}

/** Opaque model checkpoints are short-lived rollback data, never retained by designer undo history. */
export function captureDesignerEditorRollback(editor) {
  if (!editor) return null;
  return {model: editor.model, source: editor.model.snapshot(), checkpoint: editor.model.checkpoint(), view: editor.captureViewCheckpoint()};
}

export function restoreDesignerEditorRollback(editor, state) {
  if (!editor || !state) return;
  if (editor.model !== state.model) throw new Error('Cannot restore a designer edit into a replaced editor model');
  state.model.restoreCheckpoint(state.checkpoint);
  editor.restoreViewCheckpoint(state.view);
}
