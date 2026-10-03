import { EditorCommandContext } from '../commands/context.js';
import { transformOffset } from '../selections.js';

/** CodeMirror document protocol over the editor's native buffer. It owns no text, history or rendering copy. */
export class NativeCodeMirrorDocument {
  constructor(editor) {
    this.editor = editor;
    this.context = new EditorCommandContext(editor);
    this.state = { sharpforgeEditor: editor };
    this.options = new Map();
    this.listeners = new Map();
    this.marks = new Set();
    this.markSequence = 0;
    this.cleanVersion = this.changeGeneration();
    this.observeModel();
  }
  getDoc() { return this; }
  getValue(separator) {
    const value = this.context.slice();
    return separator === undefined ? value : value.replace(/\r\n|\r|\n/g, separator);
  }
  setValue(value) { this.context.apply([{ start: 0, deleteCount: this.context.length, text: String(value) }]); }
  getLine(line) { return this.context.line(line); }
  lineCount() { return this.context.lineCount; }
  firstLine() { return 0; }
  lastLine() { return this.lineCount() - 1; }
  indexFromPos(position) { return this.context.offset({ line: position.line, character: position.ch }); }
  posFromIndex(index) { const position = this.context.position(index); return { line: position.line, ch: position.character }; }
  clipPos(position) { return this.posFromIndex(this.indexFromPos(position)); }
  getRange(from, to, separator) {
    const value = this.context.slice(this.indexFromPos(from), this.indexFromPos(to));
    return separator === undefined ? value : value.replace(/\r\n|\r|\n/g, separator);
  }
  replaceRange(text, from, to = from, origin = 'keymap') {
    const start = this.indexFromPos(from);
    const end = this.indexFromPos(to);
    return this.context.apply([{ start: Math.min(start, end), deleteCount: Math.abs(end - start), text: String(text) }],
      undefined, { source: origin });
  }
  replaceSelection(text, collapse = 'end') {
    const old = this.context.selection;
    this.context.insert(text);
    if (collapse === 'start') this.context.goto(Math.min(old.anchor, old.head));
  }
  replaceSelections(values) {
    if (values.length !== this.context.selections.length) throw new RangeError('Replacement count must match selections');
    const edits = this.context.selections.map((selection, index) => ({
      start: Math.min(selection.anchor, selection.head), deleteCount: Math.abs(selection.anchor - selection.head), text: values[index]
    }));
    this.context.apply(edits);
  }
  getCursor(which = 'head') {
    const selection = this.context.selection;
    const offsets = { head: selection.head, anchor: selection.anchor,
      start: Math.min(selection.anchor, selection.head), end: Math.max(selection.anchor, selection.head) };
    return this.posFromIndex(offsets[which] ?? selection.head);
  }
  setCursor(line, ch) { this.context.goto(this.indexFromPos(typeof line === 'object' ? line : { line, ch })); }
  setSelection(anchor, head = anchor) {
    this.context.select([{ anchor: this.indexFromPos(anchor), head: this.indexFromPos(head) }]);
  }
  setSelections(ranges) {
    this.context.select(ranges.map(range => ({ anchor: this.indexFromPos(range.anchor), head: this.indexFromPos(range.head) })));
  }
  listSelections() {
    return this.context.selections.map(selection => ({ anchor: this.posFromIndex(selection.anchor), head: this.posFromIndex(selection.head) }));
  }
  somethingSelected() { return this.context.selections.some(selection => selection.anchor !== selection.head); }
  getSelection(separator = '\n') {
    return this.context.selections.map(selection => this.context.slice(Math.min(selection.anchor, selection.head),
      Math.max(selection.anchor, selection.head))).join(separator);
  }
  getSelections() { return this.context.selections.map(selection => this.context.slice(
    Math.min(selection.anchor, selection.head), Math.max(selection.anchor, selection.head))); }
  eachLine(from, to, callback) {
    if (typeof from === 'function') { callback = from; from = 0; to = this.lineCount(); }
    for (let line = from; line < to; line++) if (callback({ text: this.getLine(line), lineNo: line })) break;
  }
  operation(action) {
    this.editor.model?.beginUndoGroup?.('keymap');
    try { return action(); } finally { this.editor.model?.endUndoGroup?.(); }
  }
  undo() { this.editor.undo(); }
  redo() { this.editor.undo(true); }
  historySize() { return { undo: this.editor.model?.undoStack?.depth ?? 0, redo: this.editor.model?.undoStack?.redoDepth ?? 0 }; }
  clearHistory() { this.editor.model?.undoStack?.clear?.(); }
  changeGeneration() { return this.editor.model?.undoStack?.stateId ?? this.editor.model?.buffer?.version ?? 0; }
  isClean(generation = this.cleanVersion) { return generation === this.changeGeneration(); }
  markClean() { this.cleanVersion = this.changeGeneration(); }
  observeModel() {
    this.modelSubscription?.();
    this.modelSubscription = this.editor.model?.onDidChange?.(change => {
      for (const mark of this.marks) {
        mark.from = transformOffset(mark.from, change.changes, mark.options.inclusiveLeft ? 'left' : 'right');
        mark.to = transformOffset(mark.to, change.changes, mark.options.inclusiveRight ? 'right' : 'left');
        mark.to = Math.max(mark.from, mark.to);
      }
      this.signal('changes', change);
    });
  }
  setModel() {
    for (const mark of this.marks) mark.clear();
    this.cleanVersion = this.changeGeneration();
    this.observeModel();
  }
  getOption(name) { return name === 'readOnly' ? this.context.readOnly : this.options.get(name) ?? this.editor.options?.[name]; }
  setOption(name, value) {
    this.options.set(name, value);
    if (name === 'readOnly') this.editor.setReadOnly(value);
    else this.editor.setOptions?.({ [name]: value });
  }
  markText(from, to, options = {}) {
    const id = `keymap-mark-${++this.markSequence}`;
    const mark = { from: this.indexFromPos(from), to: this.indexFromPos(to), options,
      find: () => this.marks.has(mark) ? { from: this.posFromIndex(mark.from), to: this.posFromIndex(mark.to) } : undefined,
      clear: () => { this.marks.delete(mark); this.editor.removeDecoration?.(id); } };
    this.marks.add(mark);
    this.editor.addDecoration?.(id, { start: mark.from, end: mark.to, ...options });
    return mark;
  }
  on(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  off(name, callback) { this.listeners.get(name)?.delete(callback); }
  signal(name, ...args) { for (const callback of this.listeners.get(name) ?? []) callback(this, ...args); }
  focus() { this.editor.input.focus(); }
  getInputField() { return this.editor.input; }
  getWrapperElement() { return this.editor.element; }
  scrollIntoView(position) { this.editor.view?.reveal?.(this.indexFromPos(position.from ?? position)); }
  coordsChar(position) { return this.posFromIndex(this.editor.view.positionAt(position.left, position.top)); }
  refresh() { this.editor.paint?.(); }
  dispose() {
    this.modelSubscription?.();
    for (const mark of this.marks) mark.clear();
    this.context.dispose();
    this.listeners.clear();
    this.state.sharpforgeEditor = null;
  }
}
