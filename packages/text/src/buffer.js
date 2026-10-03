import { PieceTable } from './piece-table.js';
import { analyzeEol, eolEdits, normalizeEol } from './eol.js';

/** An edit prepared against a stale version is never silently relocated. */
export class TextVersionError extends Error {
  constructor(expected, actual) {
    super(`Text version changed: expected ${expected}, received ${actual}`);
    this.name = 'TextVersionError';
    this.code = 'TEXT_VERSION_MISMATCH';
    this.expected = expected;
    this.actual = actual;
  }
}

function normalizeEdits(source, edits, limit) {
  if (!Array.isArray(edits) || edits.length > limit) throw new RangeError(`Expected at most ${limit} text edits`);
  const sorted = edits.map(edit => {
    const start = edit.start;
    const end = edit.end ?? start + (edit.deleteCount ?? 0);
    const text = edit.text ?? edit.insertText;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > source.length) {
      throw new RangeError('Edit contains an invalid UTF-16 range');
    }
    if (typeof text !== 'string') throw new TypeError('Edit text must be a string');
    return { start, end, text };
  }).sort((first, second) => first.start - second.start || first.end - second.end);
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.start < previous.end || current.start === previous.start) throw new RangeError('Text edits overlap');
  }
  return sorted.filter(edit => edit.start !== edit.end || edit.text.length !== 0);
}

function createChanges(before, after, edits) {
  let delta = 0;
  const inverseEdits = [];
  const changes = edits.map(edit => {
    const start = edit.start + delta;
    const end = start + edit.text.length;
    inverseEdits.push(Object.freeze({ start, end, text: before.getText(edit.start, edit.end) }));
    const range = Object.freeze({ start: before.positionAt(edit.start), end: before.positionAt(edit.end) });
    const newRange = Object.freeze({ start: after.positionAt(start), end: after.positionAt(end) });
    delta += edit.text.length - (edit.end - edit.start);
    return Object.freeze({ ...edit, range, newRange, newStart: start, newEnd: end });
  });
  return { changes: Object.freeze(changes), inverseEdits: Object.freeze(inverseEdits) };
}

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
  /** Commit a prepared tree; suppress notifications only while an owning workspace commits all participants. */
  commitPrepared(prepared, { notify = true } = {}) {
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
