function captureEditor(editor) {
  if (!editor) return null;
  return {
    history: [...editor.history], future: [...editor.future], lastEdit: editor.lastEdit,
    start: editor.input.selectionStart, end: editor.input.selectionEnd,
    scrollTop: editor.input.scrollTop, scrollLeft: editor.input.scrollLeft,
    modalHistory: editor.keymapAdapter?.cm?.getHistory?.() ?? null
  };
}

function restoreEditor(editor, snapshot) {
  if (!editor || !snapshot) return;
  editor.history = [...snapshot.history];
  editor.future = [...snapshot.future];
  editor.lastEdit = snapshot.lastEdit;
  editor.input.setSelectionRange(Math.min(snapshot.start, editor.value.length), Math.min(snapshot.end, editor.value.length));
  editor.input.scrollTop = snapshot.scrollTop;
  editor.input.scrollLeft = snapshot.scrollLeft;
  if (snapshot.modalHistory) editor.keymapAdapter?.cm?.setHistory?.(snapshot.modalHistory);
  editor.cursor();
}

/** Atomic multi-file designer history at native source-editor undo boundaries. */
export class DesignerDocumentHistory {
  constructor({ files, editors, applyEdits, restored, maxEntries = 100, maxBytes = 32 * 1024 * 1024 }) {
    this.files = files;
    this.editors = editors;
    this.applyEdits = applyEdits;
    this.restored = restored;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.past = [];
    this.future = [];
    this.applying = false;
  }

  capture(changes) {
    return Object.fromEntries(changes.map(change => [change.uri, captureEditor(this.editors.get(change.uri))]));
  }

  record({ uri, changes, beforeAnalysis, afterAnalysis, beforeEditors, label = 'Designer edit' }) {
    if (!changes.length) return;
    const entry = { uri, label, changes: structuredClone(changes),
      beforeAnalysis: structuredClone(beforeAnalysis), afterAnalysis: structuredClone(afterAnalysis),
      beforeEditors, afterEditors: this.capture(changes) };
    entry.bytes = changes.reduce((sum, change) => sum + (change.before.length + change.text.length) * 2, 0);
    this.past.push(entry);
    this.future.length = 0;
    let bytes = this.past.reduce((sum, item) => sum + item.bytes, 0);
    while (this.past.length && (this.past.length > this.maxEntries || bytes > this.maxBytes)) bytes -= this.past.shift().bytes;
  }

  sourceChanged(uri) {
    if (!this.applying) this.future = this.future.filter(entry => !entry.changes.some(change => change.uri === uri));
  }

  canUndo(uri, redo = false) {
    const entry = (redo ? this.future : this.past).findLast(item => item.changes.some(change => change.uri === uri));
    if (!entry) return false;
    const primary = entry.changes.find(change => change.uri === uri);
    return this.files().find(file => file.uri === uri)?.text === (redo ? primary.before : primary.text);
  }

  /** False leaves ordinary typing undo to the editor. A conflicting other file rejects the whole operation. */
  undo(uri, redo = false) {
    const source = redo ? this.future : this.past;
    const destination = redo ? this.past : this.future;
    const index = source.findLastIndex(entry => entry.changes.some(change => change.uri === uri));
    if (index < 0) return false;
    const entry = source[index];
    const files = new Map(this.files().map(file => [file.uri, file]));
    const primary = entry.changes.find(change => change.uri === uri);
    const expected = change => redo ? change.before : change.text;
    if (files.get(uri)?.text !== expected(primary)) return false;
    for (const change of entry.changes) {
      if (files.get(change.uri)?.text !== expected(change)) {
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
      for (const [changedUri, snapshot] of Object.entries(snapshots)) restoreEditor(this.editors.get(changedUri), snapshot);
      source.splice(index, 1);
      destination.push(entry);
      this.restored?.(entry.uri, redo ? entry.afterAnalysis : entry.beforeAnalysis);
    } finally { this.applying = false; }
    return true;
  }

  clear() { this.past.length = 0; this.future.length = 0; }
  dispose() { this.clear(); }
}
