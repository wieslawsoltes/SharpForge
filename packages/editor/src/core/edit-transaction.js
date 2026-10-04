function commitTransaction(editor, edits, options, prepare) {
  if (editor.readOnly || !edits.length || editor.disposed) return false;
  const model = editor.model;
  const event = {edits, options};
  editor.notifyContributions('beforeEdit', event);
  const wasApplying = editor.applying;
  editor.applying = true;
  try {
    if (editor.model !== model) throw new Error('The editor document changed before the edit could commit');
    const prepared = prepare(model, {...options, command: options.command ?? options.source ?? 'edit',
      beforeSelections: editor.selections, beforePrimaryIndex: editor.primaryIndex});
    return model.commitPrepared(prepared);
  } finally {
    editor.applying = wasApplying;
    editor.notifyContributions('afterEdit', event);
  }
}

/** Native and contributed edits share the same view selections and contribution/undo transaction boundary. */
export function applyEditorEdits(editor, edits, options = {}) {
  if (editor.readOnly || !edits.length || editor.disposed) return false;
  const normalized = edits.map(edit => ({start: edit.start, end: edit.end ?? edit.start + (edit.deleteCount ?? 0),
    text: edit.text ?? edit.newText ?? edit.insertText ?? ''}));
  const selections = options.selections?.map(selection => ({...selection, active: selection.active ?? selection.head ?? selection.end}));
  return commitTransaction(editor, normalized, {...options, selections}, (model, settings) => model.prepareEdits(normalized, settings));
}

/** Commit a prepared private tree using current view selections; intervening source edits are rejected by the model. */
export function commitEditorPrepared(editor, prepared) {
  if (prepared.owner !== editor.model) throw new TypeError('Prepared edit belongs to another editor model');
  return commitTransaction(editor, prepared.changes, prepared.options,
    (model, settings) => {
      settings.check?.();
      return model.bindPreparedEdits(prepared.bufferEdit, settings);
    });
}
