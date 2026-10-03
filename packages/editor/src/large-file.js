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

  async load(blob, {signal = null, encoding = 'utf-8', chunkSize = 1024 * 1024, onProgress = null} = {}) {
    if (!blob || typeof blob.slice !== 'function') throw new TypeError('Expected a File or Blob');
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 8 * 1024 * 1024) {
      throw new RangeError('Document load chunks must contain between 1 byte and 8 MiB');
    }
    if (!Number.isSafeInteger(blob.size) || blob.size < 0) throw new RangeError('Invalid document byte size');
    const generation = ++this.generation;
    const decoder = new TextDecoder(encoding, {fatal: true});
    const buffer = new TextBuffer('', {uri: this.editor.uri, encoding});
    let completed = false;
    try {
      for (let start = 0; start < blob.size; start += chunkSize) {
        if (signal?.aborted || generation !== this.generation) throw new DOMException('Document load cancelled', 'AbortError');
        const bytes = new Uint8Array(await blob.slice(start, start + chunkSize).arrayBuffer());
        const text = decoder.decode(bytes, {stream: start + chunkSize < blob.size});
        buffer.applyEdits([{start: buffer.length, end: buffer.length, text}], {source: 'load'});
        onProgress?.({loaded: Math.min(blob.size, start + chunkSize), total: blob.size});
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (signal?.aborted || generation !== this.generation || this.editor.disposed) throw new DOMException('Document load cancelled', 'AbortError');
      const model = new EditorModel('', {uri: this.editor.uri, buffer});
      this.editor.setModel(this.editor.uri, model);
      model.markSaved();
      completed = true;
      return model;
    } finally {
      if (!completed) buffer.dispose();
    }
  }

  dispose() { this.generation++; }
}
import {TextBuffer} from '@sharpforge/text';
import {EditorModel} from './model.js';
