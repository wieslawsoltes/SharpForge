import {EditorModel} from '@sharpforge/editor';

/** Real public source/undo model with an explicit lightweight view boundary for Studio controller tests. */
export function editorModelView(text, uri = 'View.cs') {
  const model = new EditorModel(text, {uri});
  const editor = {
    model, uri, primaryIndex: 0, selections: model.selections.map(selection => ({...selection})),
    get value() { return this.model.value; },
    get history() { return {length: this.model.undoStack.depth}; },
    get future() { return {length: this.model.undoStack.redoDepth}; },
    get readOnly() { return this.model.readOnly; },
    getSelections() { return this.selections.map(selection => ({...selection})); },
    setSelections(selections, {primaryIndex = 0} = {}) {
      this.model.setSelections(selections, {primaryIndex, notify: false});
      this.selections = this.model.selections.map(selection => ({...selection}));
      this.primaryIndex = this.model.primaryIndex;
      this.cursor();
    },
    setValue(value) { return this.model.setValue(value, {command: 'setValue', undoStop: true}); },
    captureViewCheckpoint() {
      return {owner: this, model: this.model, version: this.model.version,
        selections: this.getSelections(), primaryIndex: this.primaryIndex, top: this.view.scrollTop, left: this.view.viewport.scrollLeft};
    },
    restoreViewCheckpoint(checkpoint) {
      if (checkpoint.owner !== this || checkpoint.model !== this.model || checkpoint.version !== this.model.version) {
        throw new Error('View checkpoint owner or version changed');
      }
      this.setSelections(checkpoint.selections, {primaryIndex: checkpoint.primaryIndex});
      this.view.scrollTo(checkpoint);
      this.refreshPreview();
    },
    refreshPreview() { this.refreshes = (this.refreshes ?? 0) + 1; },
    cursor() { this.cursorUpdates = (this.cursorUpdates ?? 0) + 1; },
    view: {scrollTop: 0, viewport: {scrollLeft: 0},
      scrollTo({top, left}) { this.scrollTop = top; this.viewport.scrollLeft = left; }},
    dispose() { this.unsubscribe(); this.model.dispose(); }
  };
  editor.unsubscribe = model.onDidChange(() => {
    editor.selections = model.selections.map(selection => ({...selection}));
    editor.primaryIndex = model.primaryIndex;
  });
  return editor;
}

/** Native focus propagation stays real in the explicit DOM fixture; source offsets use the public full-buffer bridge. */
export function attachEditorModelInput(editor, input) {
  const primary = () => editor.getSelections()[editor.primaryIndex];
  Object.defineProperties(input, {
    value: {configurable: true, get: () => editor.value, set: value => editor.setValue(value)},
    selectionStart: {configurable: true, get: () => Math.min(primary().anchor, primary().active)},
    selectionEnd: {configurable: true, get: () => Math.max(primary().anchor, primary().active)},
    scrollTop: {configurable: true, get: () => editor.view.scrollTop, set: value => { editor.view.scrollTop = value; }},
    scrollLeft: {configurable: true, get: () => editor.view.viewport.scrollLeft,
      set: value => { editor.view.viewport.scrollLeft = value; }}
  });
  input.setSelectionRange = (start, end, direction) => editor.setSelections([
    direction === 'backward' ? {anchor: end, active: start} : {anchor: start, active: end}
  ]);
  editor.input = input;
  editor.focus = () => input.focus();
  editor.paint = () => {};
  return editor;
}
