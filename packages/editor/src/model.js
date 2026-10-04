import { TextBuffer, TextVersionError, VisualColumnIndex } from '@sharpforge/text';
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
  #visualColumns;
  #visualColumnOptions;
  #preview = null;
  #ownershipEpoch = 0;
  #preparationEpochs = new WeakMap();
  #pendingNotifications = new WeakSet();
  constructor(text = '', { uri = 'Program.cs', buffer = null, selections = [{ anchor: 0, active: 0 }], ...options } = {}) {
    this.ownsBuffer = buffer === null;
    this.buffer = buffer ?? new TextBuffer(text, { uri, ...options });
    this.undoStack = new UndoStack(options.undo ?? options);
    this.uri = this.buffer.uri;
    this.scroll = { top: 0, left: 0 };
    this.decorations = new Map();
    this.#selectionState = normalizeSelections(selections, this.length);
    this.#readOnly = !!options.readOnly;
    this.#visualColumnOptions = options.visualColumns;
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
  /** Workspace consumers see committed source while the owning view displays temporary preview edits. */
  publishedSnapshot() {
    if (this.#preview) this.#assertPreviewSource();
    return this.#preview?.lease.source ?? this.snapshot();
  }
  get previewActive() { return this.#preview !== null; }
  get editOwnershipEpoch() { return this.#ownershipEpoch; }
  /** Acquire exclusive temporary-edit ownership. Preview writes never enter the document's undo history. */
  beginPreview() {
    this.#assertWritable();
    const lease = Object.freeze({source: this.snapshot()});
    this.#preview = {lease, buffer: this.buffer.checkpoint(), selections: this.#selectionState,
      scroll: {...this.scroll}, current: lease.source};
    this.#ownershipEpoch++;
    return lease;
  }
  /** Restore visual source and view state only; legitimate saved markers on committed history survive. */
  restorePreview(lease) {
    if (this.#disposed) return false;
    this.#assertPreview(lease);
    const preview = this.#preview;
    this.#assertPreviewSource();
    this.buffer.restoreCheckpoint(preview.buffer);
    this.#selectionState = preview.selections;
    this.scroll = {...preview.scroll};
    preview.current = lease.source;
    return true;
  }
  /** Restore and release before a real workspace transaction; repeated release is harmless. */
  endPreview(lease) {
    if (this.#disposed || !this.#preview) return false;
    this.#assertPreview(lease);
    try { this.restorePreview(lease); }
    finally {
      this.#preview = null;
      this.#ownershipEpoch++;
    }
    return true;
  }
  /** Exact zero-based display column; an uncached prefix is scanned cooperatively and may reject on edits or cancellation. */
  async visualColumnAtOffset(offset, options) { return this.#columnIndex().get(offset, options); }
  /** Synchronous exact result, or null while a prefix needs asynchronous indexing. */
  cachedVisualColumnAtOffset(offset, options) { return this.#columnIndex().getCached(offset, options); }
  get visualColumnStatistics() { return this.#visualColumns?.statistics ?? null; }
  #columnIndex() {
    if (this.#disposed) {
      const error = new Error('EditorModel is disposed');
      error.name = 'VisualColumnError';
      error.code = 'VISUAL_COLUMN_DISPOSED';
      throw error;
    }
    return this.#visualColumns ??= new VisualColumnIndex(this.buffer, this.#visualColumnOptions);
  }
  setSelections(selections, { primaryIndex = 0, notify = true } = {}) {
    this.#selectionState = normalizeSelections(selections, this.length, primaryIndex);
    if (notify) for (const listener of [...this.#selectionListeners]) listener(this.#selectionState);
    return this.selections;
  }
  getSelections() { return this.selections; }
  onDidChange(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  onDidChangeSelection(listener) { this.#selectionListeners.add(listener); return () => this.#selectionListeners.delete(listener); }
  prepareEdits(edits, options = {}) {
    this.#assertWritable(options);
    const epoch = this.#ownershipEpoch;
    const prepared = this.buffer.prepareEdits(edits, options);
    this.#assertEpoch(epoch);
    return this.bindPreparedEdits(prepared, options);
  }
  /** Construct one private edit transaction with bounded work; the caller still owns the explicit commit. */
  async prepareEditsAsync(edits, options = {}) {
    this.#assertWritable(options);
    const epoch = this.#ownershipEpoch;
    const prepared = await this.buffer.prepareEditsAsync(edits, options);
    this.#assertWritable(options);
    this.#assertEpoch(epoch);
    return this.bindPreparedEdits(prepared, options);
  }
  /** Bind a current prepared buffer transaction to explicit view selections without changing model or undo state. */
  bindPreparedEdits(prepared, options = {}) {
    this.#assertWritable(options);
    if (prepared.owner !== this.buffer) throw new TypeError('Prepared edit belongs to another buffer');
    if (prepared.before !== this.snapshot()) throw new TextVersionError(prepared.oldVersion, this.version);
    const ownershipEpoch = this.#preparationEpochs.get(prepared) ?? this.#ownershipEpoch;
    this.#assertEpoch(ownershipEpoch);
    this.#preparationEpochs.set(prepared, ownershipEpoch);
    const beforeState = options.beforeSelections
      ? normalizeSelections(options.beforeSelections, prepared.before.length, options.beforePrimaryIndex ?? this.primaryIndex)
      : this.#selectionState;
    const nextSelections = options.selections
      ? normalizeSelections(options.selections, prepared.after.length,
        options.primaryIndex ?? Math.min(beforeState.primaryIndex, options.selections.length - 1))
      : transformSelections(beforeState.selections, prepared.changes, prepared.after.length, beforeState.primaryIndex);
    return Object.freeze({
      ...prepared, bufferEdit: prepared, owner: this, ownershipEpoch,
      beforeSelections: beforeState.selections, beforePrimaryIndex: beforeState.primaryIndex, nextSelections, options: Object.freeze({ ...options })
    });
  }
  commitPrepared(prepared, { notify = true } = {}) {
    if (prepared.owner !== this) throw new TypeError('Prepared edit belongs to another model');
    this.#assertWritable(prepared.options);
    this.#assertEpoch(prepared.ownershipEpoch);
    if (this.#preview && notify) throw this.#previewError('Preview edits cannot publish source-change events');
    this.buffer.commitPrepared(prepared.bufferEdit, { notify: false });
    this.#selectionState = prepared.nextSelections;
    if (this.#preview) this.#preview.current = this.snapshot();
    else {
      this.undoStack.record(prepared, {
        ...prepared.options, beforeSelections: prepared.beforeSelections, afterSelections: this.selections,
        beforePrimaryIndex: prepared.beforePrimaryIndex, afterPrimaryIndex: this.primaryIndex
      });
      this.#pendingNotifications.add(prepared);
    }
    if (notify) this.emitChange(prepared);
    return prepared;
  }
  emitChange(event) {
    if (event.options?.previewLease) throw this.#previewError('Preview edits cannot publish source-change events');
    if (!this.#pendingNotifications.delete(event)) throw this.#previewError('Only an unpublished committed edit can emit a source change');
    const model = this;
    const change = Object.freeze({ ...event, get text() { return event.after.text; }, get value() { return event.after.text; }, model });
    if (event.bufferEdit) this.buffer.emitChange(event.bufferEdit);
    if (event.changes.length) for (const listener of [...this.#listeners]) listener(change);
    for (const listener of [...this.#selectionListeners]) listener(this.#selectionState);
  }
  applyEdits(edits, options) { return this.commitPrepared(this.prepareEdits(edits, options)); }
  setValue(text, options = {}) {
    this.#assertWritable(options);
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
    this.#assertPreview();
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
    const notifications = events.map(event => ({ ...event, bufferEdit: event, owner: this, undoBefore: before }));
    for (const event of notifications) this.#pendingNotifications.add(event);
    for (const event of notifications) this.emitChange(event);
    return true;
  }
  undo() { return this.#restoreHistory(false); }
  redo() { return this.#restoreHistory(true); }
  markSaved() { this.undoStack.markSaved(); }
  pushUndoStop() { this.undoStack.pushUndoStop(); }
  beginUndoGroup(command) { this.undoStack.beginUndoGroup(command); }
  endUndoGroup() { this.undoStack.endUndoGroup(); }
  checkpoint() {
    return { owner: this, ownershipEpoch: this.#ownershipEpoch, buffer: this.buffer.checkpoint(),
      undo: this.undoStack.checkpoint(), selections: this.#selectionState, scroll: { ...this.scroll } };
  }
  restoreCheckpoint(checkpoint, { notify = false } = {}) {
    if (this.#disposed) throw new Error('EditorModel is disposed');
    this.#assertPreview();
    if (checkpoint.owner !== this) throw new TypeError('Checkpoint belongs to another model');
    this.#assertEpoch(checkpoint.ownershipEpoch);
    this.#pendingNotifications = new WeakSet();
    this.buffer.restoreCheckpoint(checkpoint.buffer);
    this.undoStack.restoreCheckpoint(checkpoint.undo);
    this.#selectionState = checkpoint.selections;
    this.scroll = { ...checkpoint.scroll };
    if (notify) for (const listener of [...this.#selectionListeners]) listener(this.#selectionState);
  }
  #previewError(message, code = 'SFEDITOR_PREVIEW_ACTIVE') {
    const error = new Error(message);
    error.code = code;
    return error;
  }
  #assertPreview(lease) {
    if (this.#preview ? lease !== this.#preview.lease : lease !== undefined) {
      throw this.#previewError('Finish or cancel the active source preview before changing the document');
    }
  }
  #assertPreviewSource() {
    if (this.snapshot() === this.#preview.current) return;
    this.#preview = null;
    this.#ownershipEpoch++;
    throw this.#previewError('Source changed outside the preview; its ownership was released', 'SFEDITOR_PREVIEW_STALE');
  }
  #assertEpoch(epoch) {
    if (epoch !== this.#ownershipEpoch) throw this.#previewError('Prepared edit ownership changed', 'SFEDITOR_PREVIEW_STALE');
  }
  #assertWritable(options = {}) {
    if (this.#disposed) throw new Error('EditorModel is disposed');
    this.#assertPreview(options.previewLease);
    if (this.#preview) this.#assertPreviewSource();
    if (!this.#readOnly) return;
    const error = new Error('The document is read-only');
    error.code = 'SFEDITOR_READ_ONLY';
    throw error;
  }
  dispose() {
    let stale;
    try { if (this.#preview) this.restorePreview(this.#preview.lease); }
    catch (error) { stale = error; }
    this.#preview = null;
    this.#ownershipEpoch++;
    this.#disposed = true;
    this.#listeners.clear();
    this.#selectionListeners.clear();
    this.#readOnlyListeners.clear();
    this.#pendingNotifications = new WeakSet();
    this.#visualColumns?.dispose();
    this.decorations.clear();
    if (this.ownsBuffer) this.buffer.dispose();
    if (stale) throw stale;
  }
}
