import assert from 'node:assert/strict';
import { EditorModel } from '../../packages/editor/src/model.js';
import { EditorEditing } from '../../packages/editor/src/core/editing.js';
import { EditorSelectionCommands } from '../../packages/editor/src/core/selection-commands.js';
import { editorCommandMap } from '../../packages/editor/src/core/command-map.js';
import { editorOptions } from '../../packages/editor/src/options.js';
import { FoldingModel } from '../../packages/editor/src/folding.js';
import { BookmarkModel } from '../../packages/editor/src/bookmarks.js';
import { NativeKeymapAdapter } from '../../packages/editor/src/keymaps/native.js';

/** Headless view/provider seams around the production model, editing commands, folding and keymap implementation. */
export function createNativeEditor(text = '', { mode = 'vscode', selections = [[0, 0]], primaryIndex = 0,
  options = {}, clipboard, requestHost, platform = 'windows', prompt, pairs = [] } = {}) {
  const model = new EditorModel(text, { uri: 'file:///fixture.cs' });
  const messages = [];
  const requests = [];
  let clipboardText = '';
  const memoryClipboard = {
    readText: async () => clipboardText,
    writeText: async value => { clipboardText = value; }
  };
  const editor = {
    model, contributions: new Set(), uri: model.uri, options: editorOptions(options), messages, requests,
    element: { dataset: {}, clientHeight: 440 }, input: { readOnly: false, focus() { editor.focused = true; } },
    lineHeight: 22, overtype: false, pairs: new Map(pairs), folding: new FoldingModel(), bookmarks: new BookmarkModel(model),
    view: { scrollTop: 0, scrollLeft: 0, viewport: { clientHeight: 440 }, reveal(offset) { this.revealed = offset; },
      scrollTo({ top = this.scrollTop, left = this.scrollLeft }) { this.scrollTop = Math.max(0, top); this.scrollLeft = Math.max(0, left); } },
    get value() { return this.model.getText(); },
    get primaryIndex() { return this.model.primaryIndex; },
    get selections() { return this.model.selections; },
    get offset() { const selection = this.model.primarySelection; return Math.min(selection.anchor, selection.active); },
    get caretOffset() { return this.model.primarySelection.active; },
    get readOnly() { return this.input.readOnly; },
    get clipboardText() { return clipboardText; },
    set clipboardText(value) { clipboardText = value; },
    getSelections() { return this.model.selections.map(selection => ({ ...selection })); },
    setSelections(values, settings) { return this.model.setSelections(values, settings); },
    applyEdits(edits, settings = {}) {
      if (this.readOnly || this.disposed || !edits.length) return false;
      return this.model.applyEdits(edits, settings);
    },
    goto(anchor, active = anchor) { this.setSelections([{ anchor, active }]); },
    gotoLine(line, column = 1) { this.goto(this.model.offsetAt({ line: line - 1, character: column - 1 })); },
    insertText(value, settings) { return this.editing.insertText(value, settings); },
    insertNewline() { return this.editing.insertNewline(); },
    deleteText(direction, settings) { return this.editing.deleteText(direction, settings); },
    toggleLineComment(force) { return this.editing.toggleLineComment(force); },
    moveLines(direction) { return this.editing.moveLines(direction); },
    undo(redo = false) { return this.readOnly ? false : this.model[redo ? 'redo' : 'undo'](); },
    updateOptions(changes) { this.options = editorOptions(changes, this.options); },
    setOptions(changes) { this.updateOptions(changes); },
    setReadOnly(value) { this.input.readOnly = !!value; },
    setZoom(value) { this.updateOptions({ zoom: value }); },
    runCommand(id, args) {
      const handler = this.commandMap.get(id);
      if (!handler) throw new Error(`Unimplemented view command: ${id}`);
      return handler(args);
    },
    addVerticalCaret(direction) { return this.selectionCommands.addVerticalCaret(direction); },
    splitSelectionIntoLines() { return this.selectionCommands.splitLines(); },
    extendBox(settings) { return this.selectionCommands.extendBox(settings); },
    goToMatchingBrace(extend) { return this.selectionCommands.matchingBrace(extend); },
    selectCurrentLine() { return this.selectionCommands.currentLine(); },
    toggleBookmark() { this.bookmarks.toggle(this.model.positionAt(this.offset).line); },
    nextBookmark(direction) {
      const line = this.bookmarks.next(this.model.positionAt(this.offset).line, direction);
      if (line !== null) this.gotoLine(line + 1);
    },
    addDecoration(id, decoration) { this.model.decorations.set(id, decoration); },
    removeDecoration(id) { this.model.decorations.delete(id); },
    closeCompletion() { this.completionClosed = true; },
    registerContribution(contribution) { this.contributions.add(contribution); return () => this.contributions.delete(contribution); },
    cursor() {}, sync() {}, paint() {}
  };
  editor.editing = new EditorEditing(editor);
  editor.selectionCommands = new EditorSelectionCommands(editor);
  editor.commandMap = editorCommandMap(editor);
  editor.setSelections(selections.map(selection => Array.isArray(selection)
    ? { anchor: selection[0], active: selection[1] } : selection), { primaryIndex });
  const subscription = model.onDidChange(change => { editor.folding.applyChange(change); editor.bookmarks.applyChange(change); });
  editor.adapter = new NativeKeymapAdapter(editor, {
    mode, platform, clipboard: clipboard ?? memoryClipboard, prompt, onStatus: message => messages.push(message),
    onState: state => { editor.keymapState = state; },
    requestHost: requestHost ?? ((command, params) => { requests.push({ command, params }); return true; })
  });
  editor.keymapAdapter = editor.adapter;
  const pending = [];
  const execute = editor.adapter.bindings.execute;
  editor.adapter.bindings.execute = (...args) => {
    const result = execute(...args);
    if (result?.then) pending.push(result);
    return result;
  };
  editor.press = async sequence => {
    for (const stroke of sequence.split(' ')) {
      const event = keyboardEvent(stroke, platform);
      assert.equal(editor.adapter.handle(event), true, `Shortcut ${stroke} must be consumed`);
      assert.equal(event.defaultPrevented, true, `Shortcut ${stroke} must suppress its browser default`);
    }
    await Promise.allSettled(pending.splice(0));
  };
  editor.feed = async tokens => {
    for (const token of typeof tokens === 'string' ? [...tokens] : tokens) {
      await editor.adapter.vim.feed(token === ' ' ? 'Space' : token, true);
    }
  };
  editor.dispose = () => {
    for (const contribution of editor.contributions) contribution.dispose?.();
    editor.contributions.clear();
    editor.adapter.dispose(); subscription(); editor.disposed = true;
  };
  return editor;
}

const shifted = { '[': ['{', 'BracketLeft'], ']': ['}', 'BracketRight'], '\\': ['|', 'Backslash'],
  ',': ['<', 'Comma'], '.': ['>', 'Period'], '/': ['?', 'Slash'], ';': [':', 'Semicolon'],
  '-': ['_', 'Minus'], '=': ['+', 'Equal'] };
const codes = { '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', ',': 'Comma', '.': 'Period', '/': 'Slash',
  ';': 'Semicolon', '-': 'Minus', '=': 'Equal' };

/** Browser-shaped events deliberately use shifted punctuation, rather than repeating the binding's stored key string. */
export function keyboardEvent(stroke, platform = 'windows') {
  const parts = stroke.split('+');
  let key = parts.pop();
  const modifiers = new Set(parts.map(value => value === 'Mod' ? platform === 'mac' ? 'Meta' : 'Ctrl' : value));
  const shiftKey = modifiers.has('Shift');
  let code = codes[key] ?? (/^[A-Za-z]$/.test(key) ? `Key${key.toUpperCase()}` : key);
  if (shiftKey && shifted[key]) [key, code] = shifted[key];
  else if (/^[A-Za-z]$/.test(key)) key = shiftKey ? key.toUpperCase() : key.toLowerCase();
  if (key === 'Space') key = ' ';
  return { key, code, shiftKey, ctrlKey: modifiers.has('Ctrl'), metaKey: modifiers.has('Meta'), altKey: modifiers.has('Alt'),
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, getModifierState() { return false; } };
}

export const selectionPairs = editor => editor.getSelections().map(({ anchor, active }) => [anchor, active]);
export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
