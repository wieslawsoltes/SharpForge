import { createEditorCommandRegistry } from '../commands/index.js';
import { KeybindingService } from './resolve.js';
import { visualStudioBindings } from './visual-studio.js';
import { vscodeBindings } from './vscode.js';
import { sublimeBindings } from './sublime.js';
import { emacsBindings } from './emacs.js';
import { commonBindings } from './common.js';
import { EmacsState } from './kill-ring.js';
import { VimKeymap } from './vim.js';
import { NativeCodeMirrorDocument } from './native-document.js';
import { transformOffset } from '../selections.js';

const profiles = Object.freeze({
  'visual-studio': visualStudioBindings, vscode: vscodeBindings, sublime: sublimeBindings, emacs: emacsBindings,
  vim: commonBindings.filter(binding => binding.keys.includes('Mod+') || /^F\d/.test(binding.keys))
});

export function getProfileBindings(profile) {
  const bindings = profiles[profile];
  if (!bindings) throw new Error(`Unknown editor profile '${profile}'`);
  return bindings;
}

/** All profiles route through the same command registry and native text model, including modal Vim and Emacs. */
export class NativeKeymapAdapter {
  constructor(editor, { mode = 'visual-studio', onState, onStatus, clipboard, requestHost, platform, prompt } = {}) {
    this.editor = editor;
    this.doc = editor.element?.ownerDocument;
    this.onState = onState ?? (value => editor.onKeymapState?.(value));
    this.onStatus = onStatus ?? (message => this.onState({ keymap: this.mode, mode: message }));
    this.commands = createEditorCommandRegistry(editor, { clipboard, requestHost, onStatus: this.onStatus });
    this.context = this.commands.context;
    this.emacs = new EmacsState(this.context);
    this.vim = new VimKeymap(this.context, { onState: this.onState, prompt });
    this.cm = new NativeCodeMirrorDocument(editor);
    this.bindings = new KeybindingService({
      execute: (command, args) => this.execute(command, args), onStatus: this.onStatus,
      onError: error => this.onStatus(error.message), platform: platform ??
        (/Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? 'mac' : 'windows'),
      context: () => ({ editorTextFocus: true, editorReadonly: this.context.readOnly,
        editorHasSelection: this.context.selections.some(selection => selection.anchor !== selection.head) })
    });
    for (const id of [...new Set(emacsBindings.map(binding => binding.command).filter(id => id.startsWith('Emacs.')))]) {
      this.commands.register(id, () => this.emacs.execute(id));
    }
    this.setMode(mode);
    this.observeModel();
  }
  setMode(mode) {
    const bindings = getProfileBindings(mode);
    if (this.mode === 'vim' && mode !== 'vim') this.closeInsertGroup();
    this.bindings.setBindings(bindings);
    this.mode = mode;
    this.editor.keymap = mode;
    if (mode === 'vim' && ['insert', 'replace'].includes(this.vim.mode) && !this.vim.inUndoGroup && !this.context.readOnly) {
      this.editor.model?.beginUndoGroup?.('vim-insert');
      this.vim.inUndoGroup = true;
      this.vim.keys = [this.vim.mode === 'replace' ? 'R' : 'i'];
    }
    if (this.editor.element) this.editor.element.dataset.keymap = mode;
    this.onState({ keymap: mode, mode: mode === 'vim' ? this.vim.mode : 'editing' });
  }
  closeInsertGroup() {
    if (!this.vim.inUndoGroup) return;
    this.editor.model?.endUndoGroup?.();
    this.vim.inUndoGroup = false;
    this.vim.keys.push('Escape');
    this.vim.finishChange();
    this.vim.resetPending();
  }
  beforeModelChange() {
    this.modelSubscription?.();
    this.closeInsertGroup();
    this.bindings.cancel();
    this.vim.resetPending();
    this.vim.mode = 'normal';
    this.emacs.markActive = false;
    this.emacs.mark = null;
  }
  setModel() {
    this.bindings.cancel();
    this.cm.signal('swapDoc');
    this.doc = this.editor.element?.ownerDocument;
    this.observeModel();
    this.cm.setModel();
  }
  observeModel() {
    this.modelSubscription?.();
    this.modelSubscription = this.editor.model?.onDidChange?.(change => {
      for (const mark of this.vim.marks.values()) {
        if (mark.uri === this.context.uri) mark.offset = transformOffset(mark.offset, change.changes, 'right');
      }
      if (this.emacs.mark !== null) this.emacs.mark = transformOffset(this.emacs.mark, change.changes, 'left');
    });
  }
  handle(event) {
    if (this.disposed || event.isComposing || this.editor.composing || event.keyCode === 229) return false;
    if (this.mode === 'vim') {
      try { if (this.vim.handle(event)) return true; }
      catch (error) { this.vim.resetPending(); this.onStatus(error.message); event.preventDefault(); return true; }
    }
    return this.bindings.handle(event, { scope: 'Text Editor' });
  }
  execute(command, args) {
    if (this.disposed) return false;
    if (this.mode === 'emacs' && this.emacs.markActive && /^(Edit\.(Char|Line|Word|Subword|Document|Page))/.test(command) &&
      !command.endsWith('Extend') && this.commands.has(command + 'Extend')) {
      command += 'Extend';
    }
    const result = this.commands.execute(command, args);
    if (this.mode === 'emacs') this.emacs.afterCommand(command);
    return result;
  }
  focus() { this.editor.input.focus(); }
  goto(start, end = start, focus = true) {
    this.context.select([{ anchor: start, head: end }]);
    if (focus) this.focus();
  }
  undo(redo = false) { this.editor.model?.[redo ? 'redo' : 'undo']?.(); }
  syncFromBridge() { this.cm.signal('changes'); }
  setReadOnly() { this.cm.signal('optionChange', 'readOnly'); }
  decorate() { this.cm.signal('update'); }
  coordinates(event) { return this.editor.view.positionAt(event.clientX, event.clientY); }
  status() { return { keymap: this.mode, mode: this.mode === 'vim' ? this.vim.mode : 'editing' }; }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.modelSubscription?.();
    this.bindings.dispose();
    this.commands.dispose();
    this.vim.dispose();
    this.cm.dispose();
  }
}
