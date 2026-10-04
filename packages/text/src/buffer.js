import { PieceTable } from './piece-table.js';
import { analyzeEol, eolEdits, normalizeEol } from './eol.js';
import {normalizeEdits, createChanges} from './buffer-edits.js';
import {prepareOrderedEdits} from './prepare-edits.js';
import {TextVersionError} from './version-error.js';
export {TextVersionError} from './version-error.js';

/** Versioned UTF-16 buffer. Edits use original-document offsets and are committed atomically in one version. */
export class TextBuffer {
  #table;
  #listeners = new Set();
  #disposed = false;
  constructor(text = '', { uri = 'Program.cs', version = 1, encoding = 'utf-8', bom = false, maxEdits = 100000 } = {}) {
    if (!Number.isSafeInteger(version) || version < 0) throw new RangeError('Invalid text version');
    if (!Number.isSafeInteger(maxEdits) || maxEdits < 1) throw new RangeError('Invalid edit limit');
    this.#table = new PieceTable(text, { uri, version });
    this.uri = uri;
    this.encoding = encoding;
    this.bom = bom;
    this.maxEdits = maxEdits;
    this.preferredEol = this.metadata.dominantEol;
  }
  get length() { return this.#table.length; }
  get lineCount() { return this.#table.lineCount; }
  get version() { return this.#table.version; }
  get text() { return this.snapshot().text; }
  get value() { return this.text; }
  get lineStarts() { return this.snapshot().lineStarts; }
  get statistics() { return this.#table.statistics; }
  get metadata() { return analyzeEol(this.snapshot(), { encoding: this.encoding, bom: this.bom, defaultEol: this.preferredEol }); }
  getText(start = 0, end = this.length) { return this.#table.getText(start, end); }
  substring(start = 0, end = this.length) { return this.snapshot().substring(start, end); }
  getLineStart(line) { return this.lineStart(line); }
  getLineEnd(line, includeEol = false) { return this.lineEnd(line, includeEol); }
  getLine(line, options) { return this.#table.getLine(line, options); }
  lineStart(line) { return this.snapshot().lineStart(line); }
  lineEnd(line, includeEol = false) { return this.snapshot().lineEnd(line, includeEol); }
  positionAt(offset) { return this.#table.positionAt(offset); }
  offsetAt(position) { return this.#table.offsetAt(position); }
  snapshot() { return this.#table.snapshot(); }
  onDidChange(listener) {
    if (this.#disposed) throw new Error('TextBuffer is disposed');
    if (typeof listener !== 'function') throw new TypeError('Expected a change listener');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  /** Validate and construct the next persistent tree without mutation or notification. */
  prepareEdits(edits, { source = 'edit', expectedVersion = this.version, normalizeLineEndings = false } = {}) {
    if (this.#disposed) throw new Error('TextBuffer is disposed');
    if (expectedVersion !== this.version) throw new TextVersionError(expectedVersion, this.version);
    const before = this.snapshot();
    const normalized = normalizeEdits(before, edits, this.maxEdits);
    if (normalizeLineEndings) for (const edit of normalized) edit.text = normalizeEol(edit.text, this.preferredEol);
    let after = before;
    for (let index = normalized.length - 1; index >= 0; index--) {
      const edit = normalized[index];
      after = after.withChange(edit.start, edit.end - edit.start, edit.text);
    }
    if (normalized.length) after = after.withMetadata({ uri: this.uri, version: before.version + 1 });
    return Object.freeze({
      owner: this, before, after, oldVersion: before.version, version: after.version, source,
      ...createChanges(before, after, normalized)
    });
  }
  /** Prepare ordered original-coordinate edits cooperatively; cancellation, disposal and any source revision abort without mutation. */
  prepareEditsAsync(edits, options = {}) {
    const before = this.snapshot();
    const expectedVersion = options.expectedVersion ?? before.version;
    const check = () => {
      if (this.#disposed) throw new Error('TextBuffer is disposed');
      if (expectedVersion !== this.version || before !== this.snapshot()) throw new TextVersionError(expectedVersion, this.version);
      options.check?.();
    };
    return prepareOrderedEdits(this, before, edits, options, check);
  }
  /** Commit a prepared tree; suppress notifications only while an owning workspace commits all participants. */
  commitPrepared(prepared, { notify = true } = {}) {
    if (this.#disposed) throw new Error('TextBuffer is disposed');
    if (prepared.owner !== this || prepared.before !== this.snapshot()) throw new TextVersionError(prepared.oldVersion, this.version);
    this.#table.restore(prepared.after);
    if (notify) this.emitChange(prepared);
    return prepared;
  }
  emitChange(event) {
    if (event.owner !== this) throw new TypeError('Change belongs to another buffer');
    if (!event.changes.length) return;
    for (const listener of [...this.#listeners]) listener(event);
  }
  applyEdits(edits, options) { return this.commitPrepared(this.prepareEdits(edits, options)); }
  insert(offset, text, options) { return this.applyEdits([{ start: offset, end: offset, text }], options); }
  delete(offset, length, options) { return this.applyEdits([{ start: offset, end: offset + length, text: '' }], options); }
  convertEol(eol) {
    const edits = eolEdits(this.snapshot(), eol);
    const event = this.applyEdits(edits, { source: 'convertEol' });
    this.preferredEol = eol;
    return event;
  }
  checkpoint() { return Object.freeze({ owner: this, snapshot: this.snapshot(), preferredEol: this.preferredEol }); }
  restoreCheckpoint(checkpoint) {
    if (checkpoint.owner !== this) throw new TypeError('Checkpoint belongs to another buffer');
    this.#table.restore(checkpoint.snapshot);
    this.preferredEol = checkpoint.preferredEol;
  }
  dispose() { this.#disposed = true; this.#listeners.clear(); }
}
