import {readEditorSource} from './source-loader.js';

/** Explicit resource policy; large documents keep the same authoritative editable buffer. */
export class LargeFilePolicy {
  constructor(editor) { this.editor = editor; this.active = false; this.generation = 0; }
  update() {
    const {editor} = this;
    const active = editor.model.length >= editor.options.largeFileThreshold;
    const changed = this.active !== active;
    this.active = active;
    editor.element.classList.toggle('sf-large-file', active);
    editor.element.dataset.largeFile = String(active);
    if (active && changed) editor.accessibility?.announce('Large file mode: semantic analysis, word wrap and map preview are suspended.');
    return active;
  }

  async load(blob, options = {}) {
    const generation = ++this.generation;
    const record = await readEditorSource(blob, {...options, uri: this.editor.uri,
      isCurrent: () => generation === this.generation && !this.editor.disposed});
    try { this.editor.setModel(this.editor.uri, record.model); }
    catch (error) { record.model.dispose(); throw error; }
    return record.model;
  }

  dispose() { this.generation++; }
}
