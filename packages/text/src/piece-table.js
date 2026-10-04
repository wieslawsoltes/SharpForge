import { breakOffset, breaksBefore, charCodeAt, chunks, createStore, leaf, replace, treeStatistics } from './piece-tree.js';

function validateRange(length, start, end) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > length) {
    throw new RangeError('Text range must contain valid UTF-16 offsets');
  }
}

function clampOffset(offset, length) {
  if (!Number.isFinite(offset)) throw new RangeError('Offset must be finite');
  return Math.max(0, Math.min(length, Math.trunc(offset)));
}

/** Immutable, structurally shared UTF-16 snapshot. Full text and line starts are lazy compatibility views. */
export class PieceTableSnapshot {
  #root;
  #text;
  #lineStarts;
  constructor(root = null, { uri = 'Program.cs', version = 1 } = {}) {
    this.#root = root;
    this.uri = uri;
    this.version = version;
    Object.freeze(this);
  }
  get length() { return this.#root?.length ?? 0; }
  get lineCount() { return (this.#root?.breaks ?? 0) + 1; }
  get text() { return this.#text ??= this.getText(); }
  get lineStarts() {
    if (!this.#lineStarts) {
      const starts = new Array(this.lineCount);
      starts[0] = 0;
      for (let line = 1; line < starts.length; line++) starts[line] = breakOffset(this.#root, line);
      this.#lineStarts = Object.freeze(starts);
    }
    return this.#lineStarts;
  }
  /** Materialize only the requested range; output allocation is proportional to its length. */
  getText(start = 0, end = this.length) {
    validateRange(this.length, start, end);
    return Array.from(chunks(this.#root, start, end)).join('');
  }
  substring(start = 0, end = this.length) {
    start = Math.max(0, Math.min(this.length, Math.trunc(Number(start)) || 0));
    end = Math.max(0, Math.min(this.length, Math.trunc(Number(end)) || 0));
    return this.getText(Math.min(start, end), Math.max(start, end));
  }
  slice(start = 0, end = this.length) { return this.getText(start, end); }
  charCodeAt(offset) { return charCodeAt(this.#root, offset); }
  *chunks(start = 0, end = this.length) {
    validateRange(this.length, start, end);
    yield* chunks(this.#root, start, end);
  }
  /** Zero-based line start, located using the indexed tree rather than a flattened starts array. */
  lineStart(line) {
    if (!Number.isInteger(line) || line < 0 || line >= this.lineCount) throw new RangeError('Line outside text');
    return line === 0 ? 0 : breakOffset(this.#root, line);
  }
  lineEnd(line, includeEol = false) {
    const start = this.lineStart(line);
    let end = line + 1 < this.lineCount ? this.lineStart(line + 1) : this.length;
    if (!includeEol && end > start) {
      if (this.charCodeAt(end - 1) === 10) end--;
      if (end > start && this.charCodeAt(end - 1) === 13) end--;
    }
    return end;
  }
  getLineStart(line) { return this.lineStart(line); }
  getLineEnd(line, includeEol = false) { return this.lineEnd(line, includeEol); }
  getLine(line, { includeEol = false } = {}) { return this.getText(this.lineStart(line), this.lineEnd(line, includeEol)); }
  positionAt(offset) {
    offset = clampOffset(offset, this.length);
    const line = breaksBefore(this.#root, offset);
    return { line, character: offset - this.lineStart(line) };
  }
  offsetAt({ line, character }) {
    if (!Number.isFinite(line) || !Number.isFinite(character)) throw new RangeError('Position must be finite');
    line = Math.max(0, Math.min(this.lineCount - 1, Math.trunc(line)));
    const start = this.lineStart(line);
    return start + Math.max(0, Math.min(this.lineEnd(line) - start, Math.trunc(character)));
  }
  /** Persistent edit. The returned snapshot shares all unchanged pieces and storage. */
  withChange(start, deleteCount, insertText) {
    if (typeof insertText !== 'string') throw new TypeError('Inserted text must be a string');
    validateRange(this.length, start, start + deleteCount);
    const root = replace(this.#root, start, start + deleteCount, insertText);
    return new PieceTableSnapshot(root, { uri: this.uri, version: this.version + 1 });
  }
  withMetadata({ uri = this.uri, version = this.version } = {}) { return new PieceTableSnapshot(this.#root, { uri, version }); }
  get eolCounts() { return { cr: this.#root?.cr ?? 0, lf: this.#root?.lf ?? 0, crlf: this.#root?.crlf ?? 0 }; }
  get statistics() { return Object.freeze({ ...treeStatistics(this.#root), textMaterialized: this.#text !== undefined }); }
  snapshot() { return this; }
}

/** Mutable facade over immutable original/add pieces; edits and snapshots never copy the complete document. */
export class PieceTable {
  #snapshot;
  constructor(text = '', options = {}) {
    if (typeof text !== 'string' && !(text instanceof PieceTableSnapshot)) throw new TypeError('Text must be a string or snapshot');
    this.#snapshot = text instanceof PieceTableSnapshot ? text : new PieceTableSnapshot(text ? leaf(createStore(text)) : null, options);
  }
  get length() { return this.#snapshot.length; }
  get lineCount() { return this.#snapshot.lineCount; }
  get version() { return this.#snapshot.version; }
  get statistics() { return this.#snapshot.statistics; }
  getText(start = 0, end = this.length) { return this.#snapshot.getText(start, end); }
  substring(start = 0, end = this.length) {
    start = Math.max(0, Math.min(this.length, Math.trunc(Number(start)) || 0));
    end = Math.max(0, Math.min(this.length, Math.trunc(Number(end)) || 0));
    return this.getText(Math.min(start, end), Math.max(start, end));
  }
  getLine(line, options) { return this.#snapshot.getLine(line, options); }
  positionAt(offset) { return this.#snapshot.positionAt(offset); }
  offsetAt(position) { return this.#snapshot.offsetAt(position); }
  insert(offset, text) { return this.replace(offset, 0, text); }
  delete(offset, count) { return this.replace(offset, count, ''); }
  replace(offset, count, text) {
    this.#snapshot = this.#snapshot.withChange(offset, count, text);
    return this;
  }
  snapshot() { return this.#snapshot; }
  /** Restore a previously prepared immutable tree in constant time. */
  restore(snapshot) {
    if (!(snapshot instanceof PieceTableSnapshot)) throw new TypeError('Expected a piece-table snapshot');
    this.#snapshot = snapshot;
  }
}
