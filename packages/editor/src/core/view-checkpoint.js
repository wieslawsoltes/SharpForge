const copyItems = items => items?.map(item => ({...item})) ?? [];
const copyGroups = groups => groups.map(group => [...group]);

/** Short-lived presentation rollback for all live session views sharing the same authoritative model. */
export function captureViewCheckpoint(editor) {
  if (editor.disposed) throw new Error('CodeEditor is disposed');
  const views = [...editor.session.views].filter(view => !view.disposed && view.model === editor.model);
  return {owner: editor, model: editor.model, source: editor.model.snapshot(), version: editor.model.version, views: views.map(captureView)};
}

function captureView(view) {
  return {view, selections: view.getSelections(), primaryIndex: view.primaryIndex,
    scroll: {top: view.view.scrollTop, left: view.view.viewport.scrollLeft},
    scrollWidths: [...view.view.scroll.knownWidths], scrollExtent: view.view.scroll.extent,
    folds: copyItems(view.folding.regions), foldingEnabled: view.folding.enabled,
    pendingFoldingRestore: view.pendingFoldingRestore,
    bookmarks: {lines: [...view.bookmarks.lines], past: copyGroups(view.bookmarks.past), future: copyGroups(view.bookmarks.future)},
    tracking: {opened: view.changeTracking.opened, saved: view.changeTracking.saved, touched: [...view.changeTracking.touched]},
    diagnostics: copyItems(view.diagnostics), breakpoints: copyItems(view.breakpoints),
    decorations: [...view.decorationOwners].map(([owner, items]) => [owner, copyItems(items)]),
    executionPoint: view.executionPoint && {...view.executionPoint}, executionLine: view.executionLine,
    executionDetails: {...view.executionDetails}, selectedFrameLine: view.selectedFrameLine,
    selectionHistory: copyItems(view.selectionHistory),
    vimMarks: [...view.keymapAdapter.vim.marks].map(([key, value]) => [key, {...value}]),
    emacsMark: view.keymapAdapter.emacs.mark};
}

/** Restore the model checkpoint first. This operation does not emit source edits or change its undo stack. */
export function restoreViewCheckpoint(editor, checkpoint) {
  if (editor.disposed) throw new Error('CodeEditor is disposed');
  if (checkpoint?.owner !== editor || checkpoint.model !== editor.model || checkpoint.version !== editor.model.version ||
      checkpoint.source !== editor.model.snapshot()) {
    throw new TypeError('Restore the owning model revision before its view checkpoint');
  }
  const views = checkpoint.views.filter(saved => !saved.view.disposed && saved.view.model === checkpoint.model);
  const failures = [];
  for (const saved of views) attempt(() => cancelDeferred(saved.view), failures);
  for (const saved of views) attempt(() => restoreView(saved, failures), failures);
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, 'Some editor views could not completely restore their presentation');
}

function cancelDeferred(view) {
  clearTimeout(view.changeTimer);
  view.changeTimer = null;
  view.foldingProvider.cancel();
  view.inputController.composition.cancel();
}

function attempt(action, failures) {
  try { action(); } catch (error) { failures.push(error); }
}

function restoreView(saved, failures) {
  const {view} = saved;
  attempt(() => view.largeFile.update(), failures);
  view.selections = copyItems(saved.selections);
  view.primaryIndex = saved.primaryIndex;
  view.pendingFoldingRestore = saved.pendingFoldingRestore;
  view.bookmarks.lines = new Set(saved.bookmarks.lines);
  view.bookmarks.past = copyGroups(saved.bookmarks.past);
  view.bookmarks.future = copyGroups(saved.bookmarks.future);
  Object.assign(view.changeTracking, {opened: saved.tracking.opened, saved: saved.tracking.saved,
    touched: new Set(saved.tracking.touched)});
  view.diagnostics = copyItems(saved.diagnostics);
  attempt(() => view.insights.setDiagnostics(view.diagnostics, view.model.version), failures);
  view.diagnostics = copyItems(saved.diagnostics);
  view.breakpoints = copyItems(saved.breakpoints);
  view.decorationOwners = new Map(saved.decorations.map(([owner, items]) => [owner, copyItems(items)]));
  Object.assign(view, {executionPoint: saved.executionPoint && {...saved.executionPoint}, executionLine: saved.executionLine,
    executionDetails: {...saved.executionDetails}, selectedFrameLine: saved.selectedFrameLine,
    selectionHistory: copyItems(saved.selectionHistory)});
  view.keymapAdapter.vim.marks = new Map(saved.vimMarks.map(([key, value]) => [key, {...value}]));
  view.keymapAdapter.emacs.mark = saved.emacsMark;
  view.folding.enabled = saved.foldingEnabled;
  attempt(() => view.folding.setRanges(saved.folds, view.model.lineCount), failures);
  attempt(() => view.refreshPreview(), failures);
  // Native scrollTo clamps to the current DOM extent, so restore that extent before its logical position.
  view.view.scroll.knownWidths = new Map(saved.scrollWidths);
  view.view.scroll.extent = saved.scrollExtent;
  attempt(() => view.view.scroll.update([]), failures);
  attempt(() => view.view.scrollTo(saved.scroll), failures);
  attempt(() => view.paintViewport(), failures);
}
