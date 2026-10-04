/** Visual Studio outlining command IDs, independent of keymap parsing. */
export function outliningCommands(editor) {
  return {
    'outlining.toggle': () => editor.folding.toggle(editor.model.positionAt(editor.offset).line),
    'outlining.collapseDefinitions': () => editor.folding.collapseAll(region => region.kind === 'code' || region.kind === 'region'),
    'outlining.toggleAll': () => editor.folding.toggleAll(),
    'outlining.stop': () => { editor.folding.enabled = false; editor.folding.changed(); },
    'outlining.collapseAll': () => editor.folding.collapseAll()
  };
}
