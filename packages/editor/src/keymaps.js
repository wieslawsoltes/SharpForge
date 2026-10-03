import { NativeKeymapAdapter } from './keymaps/native.js';
import { KeybindingService } from './keymaps/resolve.js';
import { createEditorCommandRegistry } from './commands/index.js';
import { visualStudioBindings } from './keymaps/visual-studio.js';

export const EDITOR_KEYMAPS = Object.freeze([
  { id: 'visual-studio', label: 'Visual Studio (default)' },
  { id: 'vscode', label: 'Visual Studio Code' },
  { id: 'vim', label: 'Vim' },
  { id: 'emacs', label: 'Emacs' },
  { id: 'sublime', label: 'Sublime Text' }
]);

/** Compatibility constructor retained for hosts adopting the native editor incrementally. */
export class ClassicKeymapAdapter extends NativeKeymapAdapter {
  constructor(editor, mode) { super(editor, { mode }); }
}

/** Legacy entry point uses the same declarative resolver as the native editor. */
export function handleVisualStudioKey(editor, event) {
  if (editor.keymap !== 'visual-studio') return false;
  if (!editor.legacyKeybindings) {
    const commands = createEditorCommandRegistry(editor);
    const bindings = new KeybindingService({
      execute: (command, args) => commands.execute(command, args),
      onStatus: mode => editor.onKeymapState?.({ keymap: editor.keymap, mode })
    });
    bindings.setBindings(visualStudioBindings);
    editor.legacyKeybindings = { bindings, commands };
  }
  const handled = editor.legacyKeybindings.bindings.handle(event);
  editor.pendingChord = editor.legacyKeybindings.bindings.pending;
  return handled;
}

export { NativeKeymapAdapter, getProfileBindings } from './keymaps/native.js';
export { KeybindingService } from './keymaps/resolve.js';
export { platformBindingInventory, eventStroke, normalizeStroke, normalizeSequence } from './keymaps/platform.js';
