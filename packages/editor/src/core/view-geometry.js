/** Prepare committed geometry before document owners can synchronously refocus a view. */
export function prepareViewGeometry(editor, change) {
  const snapshot = change.historyEvents?.at(-1).after ?? change.after;
  const prepared = editor.geometrySnapshots;
  if (prepared.has(snapshot)) return;
  editor.largeFile.update();
  for (const event of change.historyEvents ?? [change]) editor.folding.prepareChange(event);
  // History has already committed its entire sequence. Intermediate ranges may exceed
  // the final document, so reset against that document once instead of invalidating each range.
  if (change.historyEvents) {
    editor.view.layout.reset();
    editor.view.scroll.reset();
  } else {
    editor.view.layout.invalidate(change);
    editor.view.scroll.invalidate(change);
  }
  editor.view.layout.applyFolding();
  // Measuring only visible bounded rows prevents a temporary horizontal-width collapse
  // and reconciles visible wrapping before an owner asks for the caret's coordinates.
  const view = editor.view;
  const rows = view.layout.rows(view.scrollTop, view.viewport.clientHeight || editor.element.clientHeight || 400);
  view.scroll.update(rows);
  prepared.add(snapshot);
}

export function hasPreparedViewGeometry(editor, change) {
  return editor.geometrySnapshots?.has(change.historyEvents?.at(-1).after ?? change.after) ?? false;
}
