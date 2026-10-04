/** Read through the shared model while edits and selections belong to the active view. */
export function modelForView(editor) {
  return new Proxy({}, {
    get(target, key) {
      const model = editor.model;
      if (key === 'selections') return editor.getSelections();
      if (key === 'primaryIndex') return editor.primaryIndex ?? 0;
      if (key === 'primarySelection') return editor.getSelections()[editor.primaryIndex ?? 0];
      if (key === 'applyEdits') return (edits, options) => editor.applyEdits(edits, options);
      if (key === 'setSelections') return (selections, options) => editor.setSelections(selections, options);
      const value = Reflect.get(model, key, model);
      return typeof value === 'function' ? value.bind(model) : value;
    }
  });
}
