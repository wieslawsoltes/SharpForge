import { GraphemeSegmenter } from '@sharpforge/text';
import { modelForView } from '../view/model-adapter.js';

/** Adapter shared by every keymap. Positions and edits are UTF-16; source buffers remain authoritative. */
export class EditorCommandContext {
  constructor(editor, options = {}) {
    this.editor = editor;
    this.options = options;
    this.graphemes = options.graphemes ?? new GraphemeSegmenter();
    this.words = options.words ?? (typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('und', { granularity: 'word' }) : null);
    this.selectionModel = modelForView(editor);
    this.disposed = false;
  }
  get buffer() { return this.editor.model?.buffer ?? this.editor.buffer; }
  get length() { return this.buffer?.length ?? this.editor.value.length; }
  get readOnly() { return this.disposed || this.editor.disposed || !!(this.editor.readOnly ?? this.editor.input?.readOnly); }
  get uri() { return this.editor.uri ?? this.buffer?.uri ?? ''; }
  get eol() { return this.editor.options?.endOfLine ?? this.editor.options?.eol ?? this.buffer?.preferredEol ?? '\n'; }
  get primaryIndex() { return this.editor.primaryIndex ?? this.editor.model?.primaryIndex ?? 0; }
  slice(start = 0, end = this.length) {
    return this.buffer?.substring ? this.buffer.substring(start, end) : this.editor.value.slice(start, end);
  }
  position(offset) { return (this.buffer ?? this.editor.sourceSnapshot()).positionAt(offset); }
  offset(position) { return (this.buffer ?? this.editor.sourceSnapshot()).offsetAt(position); }
  get lineCount() { return this.buffer?.lineCount ?? this.editor.sourceSnapshot().lineStarts.length; }
  lineStart(line) {
    return this.buffer?.getLineStart ? this.buffer.getLineStart(line) : this.offset({ line, character: 0 });
  }
  line(line) {
    if (this.buffer?.getLine) return this.buffer.getLine(line);
    const start = this.lineStart(line);
    const end = line + 1 < this.lineCount ? this.lineStart(line + 1) : this.length;
    return this.slice(start, end).replace(/\r?\n$|\r$/, '');
  }
  lineEnd(line, includeNewline = false) {
    return includeNewline && line + 1 < this.lineCount ? this.lineStart(line + 1) : this.lineStart(line) + this.line(line).length;
  }
  get selections() {
    const values = this.editor.getSelections?.();
    if (values?.length) return values.map(value => ({
      ...value, anchor: value.anchor ?? value.start, head: value.head ?? value.active ?? value.end,
      active: value.active ?? value.head ?? value.end
    }));
    const input = this.editor.input;
    const start = input?.selectionStart ?? this.editor.offset ?? 0;
    const end = input?.selectionEnd ?? start;
    return input?.selectionDirection === 'backward' ? [{ anchor: end, head: start }] : [{ anchor: start, head: end }];
  }
  get selection() { const selections = this.selections; return selections[Math.min(this.primaryIndex, selections.length - 1)]; }
  select(values, reveal = true, primaryIndex = Math.min(this.primaryIndex, values.length - 1)) {
    if (this.disposed || this.editor.disposed) return false;
    const selections = values.map(value => {
      const head = Math.max(0, Math.min(this.length, value.head ?? value.active ?? value.end));
      return { ...value, anchor: Math.max(0, Math.min(this.length, value.anchor ?? value.start)), active: head, head };
    });
    if (this.editor.setSelections) this.editor.setSelections(selections, { primaryIndex });
    else {
      const { anchor, head } = selections[0];
      this.editor.input.setSelectionRange(Math.min(anchor, head), Math.max(anchor, head), anchor > head ? 'backward' : 'forward');
      this.editor.cursor?.();
    }
    if (reveal) this.editor.view?.reveal?.(selections[primaryIndex].head);
    return this.selections;
  }
  goto(offset, extend = false) {
    this.select([{ anchor: extend ? this.selection.anchor : offset, head: offset }]);
  }
  apply(edits, selections, { source = 'command', undoStop = true, ...options } = {}) {
    if (this.readOnly) return false;
    if (!edits.length) return false;
    const primaryIndex = options.primaryIndex ?? Math.min(this.primaryIndex, (selections?.length ?? this.selections.length) - 1);
    if (this.editor.applyEdits) {
      const applied = this.editor.applyEdits(edits, { source, command: source, undoStop, ...options, primaryIndex, selections });
      if (applied === false) return false;
    }
    else if (edits.length === 1 && this.editor.insert) {
      const edit = edits[0];
      this.editor.insert(edit.text, edit.start, edit.start + edit.deleteCount);
    } else {
      let text = this.slice();
      for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
        text = text.slice(0, edit.start) + edit.text + text.slice(edit.start + edit.deleteCount);
      }
      this.editor.setValue(text);
    }
    if (selections) this.select(selections, true, primaryIndex);
    return true;
  }
  insert(text, { source = 'command', undoStop = true } = {}) {
    if (this.readOnly) return false;
    if (typeof this.editor.insertText === 'function') return this.editor.insertText(text, { source, command: source, undoStop });
    const edits = this.selections.map(selection => ({
      start: Math.min(selection.anchor, selection.head), deleteCount: Math.abs(selection.head - selection.anchor), text
    })).sort((left, right) => left.start - right.start);
    let delta = 0;
    const selections = edits.map(edit => {
      const head = edit.start + delta + edit.text.length;
      delta += edit.text.length - edit.deleteCount;
      return { anchor: head, head };
    });
    return this.apply(edits, selections, { source, undoStop });
  }
  host(command, params = {}) {
    const request = this.options.requestHost ?? this.editor.requestHost ?? this.editor.request;
    if (typeof request !== 'function') throw new Error(`No host provider for '${command}'`);
    return request.call(this.editor, command, { uri: this.uri, offset: this.selection.head, ...params });
  }
  status(message) { this.options.onStatus?.(message); }
  async readClipboard() {
    const clipboard = this.options.clipboard ?? globalThis.navigator?.clipboard;
    if (!clipboard?.readText) throw new Error('Clipboard reading is unavailable; use the browser paste command');
    return clipboard.readText();
  }
  async writeClipboard(text) {
    const clipboard = this.options.clipboard ?? globalThis.navigator?.clipboard;
    if (!clipboard?.writeText) throw new Error('Clipboard writing is unavailable; use the browser copy command');
    await clipboard.writeText(text);
  }
  capture() {
    return { buffer: this.buffer, uri: this.uri, profile: this.editor.keymap, version: this.buffer?.version,
      selections: JSON.stringify(this.selections) };
  }
  assertCurrent(capture, action = 'performing the command') {
    if (this.disposed || this.editor.disposed) throw new Error(`Editor was disposed while ${action}`);
    if (capture.buffer !== this.buffer || capture.uri !== this.uri || capture.profile !== this.editor.keymap || capture.version !== this.buffer?.version
      || capture.selections !== JSON.stringify(this.selections)) throw new Error(`Document or selection changed while ${action}`);
  }
  dispose() { this.disposed = true; }
}
