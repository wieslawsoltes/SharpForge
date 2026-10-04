import {captureDesignerEditorView, restoreDesignerEditorView} from './designer-editor-state.js';
import {designerHistoryBytes} from './designer-history-budget.js';

/** Atomic multi-file designer history at native source-editor undo boundaries. */
export class DesignerDocumentHistory {
  constructor({ files, editors, applyEdits, restored, maxEntries = 100, maxBytes = 32 * 1024 * 1024 }) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new RangeError('Designer history limits must be positive safe integers');
    }
    this.files = files;
    this.editors = editors;
    this.applyEdits = applyEdits;
    this.restored = restored;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.past = [];
    this.future = [];
    this.applying = false;
    this.modelIds = new WeakMap();
    this.nextModelId = 0;
  }

  modelId(model) {
    if (!this.modelIds.has(model)) this.modelIds.set(model, ++this.nextModelId);
    return this.modelIds.get(model);
  }

  capture(changes) {
    return Object.fromEntries(changes.map(change => {
      const editor = this.editors.get(change.uri);
      return [change.uri, editor ? {
        modelId: this.modelId(editor.model), undo: editor.model.undoStack.checkpoint(), view: captureDesignerEditorView(editor)
      } : null];
    }));
  }

  record({ uri, changes, beforeAnalysis, afterAnalysis, beforeEditors, label = 'Designer edit' }) {
    if (!changes.length) return;
    const entry = { uri, label, changes: structuredClone(changes),
      beforeAnalysis: structuredClone(beforeAnalysis), afterAnalysis: structuredClone(afterAnalysis),
      beforeEditors, afterEditors: this.capture(changes) };
    entry.bytes = designerHistoryBytes(entry, this.maxBytes);
    this.past.push(entry);
    this.future.length = 0;
    let bytes = this.past.reduce((sum, item) => sum + item.bytes, 0);
    while (this.past.length && (this.past.length > this.maxEntries || bytes > this.maxBytes)) bytes -= this.past.shift().bytes;
  }

  sourceChanged(uri) {
    if (!this.applying) this.future = this.future.filter(entry => !entry.changes.some(change => change.uri === uri));
  }

  canUndo(uri, redo = false) {
    const entry = (redo ? this.future : this.past).findLast(item => item.uri === uri || item.changes.some(change => change.uri === uri));
    if (!entry) return false;
    const primary = entry.changes.find(change => change.uri === uri) ?? entry.changes[0];
    return this.files().find(file => file.uri === primary.uri)?.text === (redo ? primary.before : primary.text);
  }

  /** False leaves ordinary typing undo to the editor. A conflicting other file rejects the whole operation. */
  undo(uri, redo = false) {
    const source = redo ? this.future : this.past;
    const destination = redo ? this.past : this.future;
    const index = source.findLastIndex(entry => entry.uri === uri || entry.changes.some(change => change.uri === uri));
    if (index < 0) return false;
    const entry = source[index];
    const files = new Map(this.files().map(file => [file.uri, file]));
    const primary = entry.changes.find(change => change.uri === uri) ?? entry.changes[0];
    const expected = change => redo ? change.before : change.text;
    if (files.get(primary.uri)?.text !== expected(primary)) return false;
    for (const change of entry.changes) {
      const file = files.get(change.uri);
      const editor = this.editors.get(change.uri);
      if (file?.text !== expected(change) || file.readOnly || file.readonly ||
          editor && (editor.value !== expected(change) || editor.readOnly || editor.model.readOnly)) {
        throw new Error('Cannot undo the designer transaction because ' + change.uri + ' changed independently');
      }
    }
    this.applying = true;
    try {
      const edits = entry.changes.map(change => ({
        uri: change.uri, start: 0, end: files.get(change.uri).text.length,
        newText: redo ? change.text : change.before, version: files.get(change.uri).version
      }));
      this.applyEdits(edits);
      const snapshots = redo ? entry.afterEditors : entry.beforeEditors;
      for (const [changedUri, snapshot] of Object.entries(snapshots)) {
        const editor = this.editors.get(changedUri);
        // A reopened source tab has its own native history; never install another model's checkpoint.
        if (!editor || !snapshot || this.modelId(editor.model) !== snapshot.modelId) continue;
        editor.model.undoStack.restoreCheckpoint(snapshot.undo);
        restoreDesignerEditorView(editor, snapshot.view);
      }
      source.splice(index, 1);
      destination.push(entry);
      this.restored?.(entry.uri, redo ? entry.afterAnalysis : entry.beforeAnalysis);
    } finally { this.applying = false; }
    return true;
  }

  clear() { this.past.length = 0; this.future.length = 0; }
  dispose() { this.clear(); }
}
