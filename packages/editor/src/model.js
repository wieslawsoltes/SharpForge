import { TextBuffer } from '@sharpforge/text';
import { normalizeSelections, transformSelections } from './selections.js';
import { UndoStack } from './undo.js';

/** One document's authoritative buffer, undo history and view state; snapshots and change strings are lazy. */
export class EditorModel {
  #listeners = new Set();
  #selectionListeners = new Set();
  #readOnlyListeners = new Set();
  #selectionState;
  #disposed = false;
  #readOnly = false;
  constructor(text = '', { uri = 'Program.cs', buffer = null, selections = [{ anchor: 0, active: 0 }], ...options } = {}) {
    this.ownsBuffer = buffer === null;
    this.buffer = buffer ?? new TextBuffer(text, { uri, ...options });
    this.undoStack = new UndoStack(options.undo ?? options);
    this.uri = this.buffer.uri;
    this.scroll = { top: 0, left: 0 };
    this.decorations = new Map();
    this.#selectionState = normalizeSelections(selections, this.length);
    this.#readOnly = !!options.readOnly;
  }
  get length() { return this.buffer.length; }
  get lineCount() { return this.buffer.lineCount; }
  get version() { return this.buffer.version; }
  get value() { return this.buffer.text; }
  get text() { return this.value; }
  get metadata() { return this.buffer.metadata; }
  get preferredEol() { return this.buffer.preferredEol; }
  get selections() { return this.#selectionState.selections; }
  get primaryIndex() { return this.#selectionState.primaryIndex; }
  get primarySelection() { return this.selections[this.primaryIndex]; }
  get canUndo() { return this.undoStack.canUndo; }
  get canRedo() { return this.undoStack.canRedo; }
  get isDirty() { return this.undoStack.isDirty; }
  get readOnly() { return this.#readOnly; }
  set readOnly(value) { this.setReadOnly(value); }
  /** Read-only is document state shared by all views; toggling it does not change text, version or history. */
  setReadOnly(value) {
    if (this.#disposed) throw new Error('EditorModel is disposed');
    const readOnly = !!value;
    if (readOnly === this.#readOnly) return false;
    this.#readOnly = readOnly;
    for (const listener of [...this.#readOnlyListeners]) listener(readOnly);
    return true;
  }
  onDidChangeReadOnly(listener) { this.#readOnlyListeners.add(listener); return () => this.#readOnlyListeners.delete(listener); }
  getText(start = 0, end = this.length) { return this.buffer.getText(start, end); }
  substring(start = 0, end = this.length) { return this.buffer.substring(start, end); }
  getLineEnd(line, includeEol = false) { return this.lineEnd(line, includeEol); }
  getLine(line, options) { return this.buffer.getLine(line, options); }
  getLineStart(line) { return this.buffer.lineStart(line); }
  lineStart(line) { return this.buffer.lineStart(line); }
  lineEnd(line, includeEol = false) { return this.buffer.lineEnd(line, includeEol); }
  positionAt(offset) { return this.buffer.positionAt(offset); }
  offsetAt(position) { return this.buffer.offsetAt(position); }
  snapshot() { return this.buffer.snapshot(); }
  setSelections(selections, { primaryIndex = 0, notify = true } = {}) {
    this.#selectionState = normalizeSelections(selections, this.length, primaryIndex);
    if (notify) for (const listener of [...this.#selectionListeners]) listener(this.#selectionState);
    return this.selections;
  }
  getSelections() { return this.selections; }
  onDidChange(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  onDidChangeSelection(listener) { this.#selectionListeners.add(listener); return () => this.#selectionListeners.delete(listener); }
  prepareEdits(edits, options = {}) {
    this.#assertWritable();
    const prepared = this.buffer.prepareEdits(edits, options);
    const nextSelections = options.selections
      ? normalizeSelections(options.selections, prepared.after.length, options.primaryIndex ?? Math.min(this.primaryIndex, options.selections.length - 1))
      : transformSelections(this.selections, prepared.changes, prepared.after.length, this.primaryIndex);
    return Object.freeze({
      ...prepared, bufferEdit: prepared, owner: this,
      beforeSelections: this.selections, beforePrimaryIndex: this.primaryIndex, nextSelections, options: Object.freeze({ ...options })
    });
  }
  commitPrepared(prepared, { notify = true } = {}) {
    if (prepared.owner !== this) throw new TypeError('Prepared edit belongs to another model');
    this.#assertWritable();
    this.buffer.commitPrepared(prepared.bufferEdit, { notify: false });
    this.#selectionState = prepared.nextSelections;
    this.undoStack.record(prepared, {
      ...prepared.options, beforeSelections: prepared.beforeSelections, afterSelections: this.selections,
      beforePrimaryIndex: prepared.beforePrimaryIndex, afterPrimaryIndex: this.primaryIndex
    });
    if (notify) this.emitChange(prepared);
    return prepared;
  }
  emitChange(event) {
    const model = this;
    const change = Object.freeze({ ...event, get text() { return event.after.text; }, get value() { return event.after.text; }, model });
    if (event.bufferEdit) this.buffer.emitChange(event.bufferEdit);
    if (event.changes.length) for (const listener of [...this.#listeners]) listener(change);
    for (const listener of [...this.#selectionListeners]) listener(this.#selectionState);
  }
  applyEdits(edits, options) { return this.commitPrepared(this.prepareEdits(edits, options)); }
  setValue(text, options = {}) {
    if (typeof text !== 'string') throw new TypeError('Model value must be a string');
    const snapshot = this.snapshot();
    let start = 0;
    const maximum = Math.min(snapshot.length, text.length);
    while (start < maximum && snapshot.charCodeAt(start) === text.charCodeAt(start)) start++;
    let oldEnd = snapshot.length;
    let newEnd = text.length;
    while (oldEnd > start && newEnd > start && snapshot.charCodeAt(oldEnd - 1) === text.charCodeAt(newEnd - 1)) { oldEnd--; newEnd--; }
    return this.applyEdits([{ start, end: oldEnd, text: text.slice(start, newEnd) }], options);
  }
  #restoreHistory(redo) {
    if (this.#readOnly || this.#disposed) return false;
    const before = this.snapshot();
    const events = [];
    const buffer = {
      applyEdits: (edits, options) => {
        const event = this.buffer.commitPrepared(this.buffer.prepareEdits(edits, options), { notify: false });
        events.push(event);
      }
    };
    const selections = redo ? this.undoStack.redo(buffer) : this.undoStack.undo(buffer);
    if (!selections) return false;
    this.setSelections(selections, { notify: false, primaryIndex: this.undoStack.restoredPrimaryIndex ?? 0 });
    // Views must reach the final history snapshot before the first owner notification.
    const historyEvents = Object.freeze(events);
    for (const event of historyEvents) {
      const bufferEdit = Object.freeze({ ...event, historyEvents });
      this.emitChange({ ...bufferEdit, bufferEdit, owner: this, undoBefore: before });
    }
    return true;
  }
  undo() { return this.#restoreHistory(false); }
  redo() { return this.#restoreHistory(true); }
  markSaved() { this.undoStack.markSaved(); }
  pushUndoStop() { this.undoStack.pushUndoStop(); }
  beginUndoGroup(command) { this.undoStack.beginUndoGroup(command); }
  endUndoGroup() { this.undoStack.endUndoGroup(); }
  checkpoint() {
    return { owner: this, buffer: this.buffer.checkpoint(), undo: this.undoStack.checkpoint(), selections: this.#selectionState, scroll: { ...this.scroll } };
  }
  restoreCheckpoint(checkpoint, { notify = false } = {}) {
    if (checkpoint.owner !== this) throw new TypeError('Checkpoint belongs to another model');
    this.buffer.restoreCheckpoint(checkpoint.buffer);
    this.undoStack.restoreCheckpoint(checkpoint.undo);
    this.#selectionState = checkpoint.selections;
    this.scroll = { ...checkpoint.scroll };
    if (notify) for (const listener of [...this.#selectionListeners]) listener(this.#selectionState);
  }
  #assertWritable() {
    if (this.#disposed) throw new Error('EditorModel is disposed');
    if (!this.#readOnly) return;
    const error = new Error('The document is read-only');
    error.code = 'SFEDITOR_READ_ONLY';
    throw error;
  }
  dispose() {
    this.#disposed = true;
    this.#listeners.clear();
    this.#selectionListeners.clear();
    this.#readOnlyListeners.clear();
    this.decorations.clear();
    if (this.ownsBuffer) this.buffer.dispose();
  }
}
