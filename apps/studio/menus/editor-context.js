import {undoSourceEditor} from '../designer-editor-history.js';

/** Source-editor menus use explicit commands, including the workspace's multi-file undo service. */
export function createEditorContextItems(context, instance) {
  const {EDITOR_KEYMAPS, advancedTools, breakpointItems, copyText, languageRequest, pasteEditor,
    refreshWatches, setEditorKeymap, setPanel, state} = context;
  const writable = () => !instance.input.readOnly;
  const selected = () => instance.input.selectionStart !== instance.input.selectionEnd;
  const params = () => ({uri: instance.uri, offset: instance.offset, end: instance.input.selectionEnd});
  const line = () => instance.sourceSnapshot().positionAt(instance.offset).line + 1;
  return [
    {label: 'Quick Actions and Refactorings…', shortcut: 'Ctrl+.', enabled: writable,
      action: () => languageRequest('codeActions', params())},
    {label: 'Rename…', shortcut: state.keymap === 'visual-studio' ? 'Ctrl+R, Ctrl+R' : 'F2', enabled: writable,
      action: () => languageRequest('rename', params())},
    null,
    {label: 'Go to Definition', shortcut: 'F12', action: () => languageRequest('definition', params())},
    {label: 'Find All References', shortcut: 'Shift+F12', action: () => languageRequest('references', params())},
    {label: 'View Call Hierarchy', shortcut: 'Shift+Alt+H', action: () => languageRequest('callHierarchy', params())},
    null,
    {label: 'Set Next Statement', shortcut: 'Ctrl+Shift+F10', enabled: () => state.debug?.state === 'paused' && !state.hotEdit,
      action: () => advancedTools.setNext({uri: instance.uri, line: line(),
        column: instance.sourceSnapshot().positionAt(instance.offset).character + 1})},
    {label: 'Hot Reload…', action: () => setPanel('hot-reload')},
    {label: 'Breakpoint', children: () => breakpointItems(instance.uri, line())},
    {label: 'Add Watch', enabled: selected, action: () => {
      const expression = instance.value.slice(instance.input.selectionStart, instance.input.selectionEnd).trim();
      if (expression && !state.watches.includes(expression)) { state.watches.push(expression); refreshWatches(); }
      setPanel('watch');
    }},
    null,
    {label: 'Undo', shortcut: 'Ctrl+Z', enabled: writable, action: () => undoSourceEditor(context, false, instance)},
    {label: 'Redo', shortcut: 'Ctrl+Y', enabled: writable, action: () => undoSourceEditor(context, true, instance)},
    null,
    {label: 'Cut', shortcut: 'Ctrl+X', enabled: () => writable() && selected(), action: async () => {
      const text = instance.value.slice(instance.input.selectionStart, instance.input.selectionEnd);
      try { await navigator.clipboard.writeText(text); }
      catch { await copyText(text); return; }
      instance.insert('');
    }},
    {label: 'Copy', shortcut: 'Ctrl+C', enabled: selected,
      action: () => copyText(instance.value.slice(instance.input.selectionStart, instance.input.selectionEnd))},
    {label: 'Paste', shortcut: 'Ctrl+V', enabled: writable, action: () => pasteEditor(instance)},
    {label: 'Select All', shortcut: 'Ctrl+A', action: () => instance.goto(0, instance.value.length)},
    null,
    {label: 'Find…', shortcut: 'Ctrl+F', action: () => instance.openFind(false)},
    {label: 'Replace…', shortcut: 'Ctrl+H', enabled: writable, action: () => instance.openFind(true)},
    {label: 'Format Document', shortcut: 'Ctrl+K, Ctrl+D', enabled: writable,
      action: () => languageRequest('format', {uri: instance.uri})},
    {label: 'Keyboard Profile', children: EDITOR_KEYMAPS.map(keymap => ({label: keymap.label, radio: true,
      checked: () => state.keymap === keymap.id, action: () => setEditorKeymap(keymap.id)}))}
  ];
}
