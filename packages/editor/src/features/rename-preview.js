/** Temporary model edits publish no source event and are restored before the final workspace transaction. */
export class RenamePreview {
  constructor(editor) {
    this.editor = editor;
    this.model = editor.model;
    this.original = editor.value;
    this.version = this.model?.version;
    this.expectedVersion = this.version;
    this.checkpoint = this.model?.checkpoint?.();
    this.lease = this.model?.beginPreview?.();
    this.current = this.original;
    this.active = false;
  }

  restore() {
    if (this.released) return;
    if (this.lease) this.model.restorePreview(this.lease);
    else {
      const value = this.model?.getText?.() ?? this.editor.value;
      if (value !== this.current || this.model?.version !== this.expectedVersion) {
        throw new Error('The source changed outside the rename preview');
      }
      if (this.active && this.checkpoint) this.model.restoreCheckpoint(this.checkpoint, {notify: false});
    }
    this.expectedVersion = this.version;
    this.current = this.original;
    this.active = false;
    this.repaint();
  }

  show(edits) {
    if (this.released) throw new Error('The rename preview was released');
    this.restore();
    if (this.editor.model !== this.model) throw new Error('The editor changed its active document during rename');
    if (!this.checkpoint || !this.model.prepareEdits || !this.model.commitPrepared) return false;
    const prepared = this.model.prepareEdits(edits, {source: 'rename-preview', undoStop: true, previewLease: this.lease});
    this.model.commitPrepared(prepared, {notify: false});
    this.current = this.model.getText?.() ?? this.model.snapshot().text;
    this.expectedVersion = this.model.version;
    this.active = true;
    this.repaint();
    return true;
  }

  release() {
    if (this.released) return;
    try {
      if (this.lease) this.model.endPreview(this.lease);
      else this.restore();
    } finally {
      this.released = true;
      this.active = false;
      this.repaint();
    }
  }

  dispose() { this.release(); }

  repaint() {
    const views = this.editor.session?.views ?? [this.editor];
    for (const editor of views) {
      if (editor.model !== this.model || editor.disposed) continue;
      if (editor.refreshPreview) editor.refreshPreview();
      else {
        editor.paint?.();
        editor.view?.render?.();
      }
    }
  }
}
