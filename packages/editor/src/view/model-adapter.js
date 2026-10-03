/** Explicit read/edit protocol for shared-model commands operating on one independently selected view. */
export class EditorViewModel {
  constructor(editor) { this.editor = editor; }
  get model() { return this.editor.model; }
  get buffer() { return this.model.buffer; }
  get length() { return this.model.length; }
  get lineCount() { return this.model.lineCount; }
  get version() { return this.model.version; }
  get uri() { return this.model.uri; }
  get metadata() { return this.model.metadata; }
  get preferredEol() { return this.model.preferredEol; }
  get readOnly() { return this.editor.readOnly ?? this.editor.input?.readOnly ?? false; }
  get selections() { return this.editor.getSelections(); }
  get primaryIndex() { return this.editor.primaryIndex ?? 0; }
  get primarySelection() { return this.selections[this.primaryIndex]; }
  getText(...args) { return this.model.getText(...args); }
  getLine(line) { return this.model.getLine(line); }
  getLineStart(line) { return this.model.getLineStart(line); }
  getLineEnd(line) { return this.model.getLineEnd(line); }
  lineStart(line) { return this.model.getLineStart(line); }
  lineEnd(line) { return this.model.getLineEnd(line); }
  positionAt(offset) { return this.model.positionAt(offset); }
  offsetAt(position) { return this.model.offsetAt(position); }
  snapshot() { return this.model.snapshot(); }
  substring(...args) { return this.model.substring(...args); }
  setSelections(selections, options) { return this.editor.setSelections(selections, options); }
  applyEdits(edits, options) { return this.editor.applyEdits(edits, options); }
}

export function modelForView(editor) { return new EditorViewModel(editor); }
