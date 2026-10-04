/** IME owns a transient single-caret overlay; the buffer receives exactly one committed transaction. */
export class CompositionController {
  constructor(editor, input) {
    this.editor = editor;
    this.input = input;
    this.active = false;
    this.text = '';
    this.overlay = editor.element.ownerDocument.createElement('span');
    this.overlay.className = 'sf-composition';
    this.overlay.hidden = true;
    this.overlay.setAttribute('aria-hidden', 'true');
    editor.element.append(this.overlay);
  }
  start() {
    if (this.editor.readOnly || this.editor.disposed) return;
    this.active = true;
    this.editor.composing = true;
    this.model = this.editor.model;
    this.version = this.editor.model.version;
    this.startOffset = this.editor.input.selectionStart;
    this.endOffset = this.editor.input.selectionEnd;
    this.text = '';
    this.editor.closeCompletion();
    this.editor.setSelections([{anchor: this.startOffset, active: this.endOffset}]);
  }
  update(text) {
    if (!this.active) this.start();
    if (!this.active) return;
    this.text = text ?? '';
    this.overlay.textContent = this.text;
    const position = this.editor.view.coordsAt(this.startOffset);
    this.overlay.style.left = `${position.left}px`;
    this.overlay.style.top = `${position.top}px`;
    this.overlay.style.height = `${position.height}px`;
    this.overlay.hidden = false;
  }
  end(text) {
    if (!this.active) return;
    const committed = text ?? this.text;
    const valid = this.model === this.editor.model && this.version === this.editor.model.version && !this.editor.disposed;
    this.active = false;
    this.editor.composing = false;
    this.overlay.hidden = true;
    if (valid && committed) {
      this.editor.applyEdits([{start: this.startOffset, end: this.endOffset, text: committed}], {
        selections: [{anchor: this.startOffset + committed.length, active: this.startOffset + committed.length}],
        source: 'composition', undoStop: true
      });
    }
    this.text = '';
    this.input.synchronize();
  }
  cancel() { this.active = false; this.editor.composing = false; this.overlay.hidden = true; this.text = ''; }
  dispose() { this.cancel(); this.overlay.remove(); }
}
