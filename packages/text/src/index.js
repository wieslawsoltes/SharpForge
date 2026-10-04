/** Immutable UTF-16 source snapshots; positions use the same units as browser editors/LSP. */
export class SourceText {
  #lines;
  #origin = null;
  constructor(text, uri = 'Program.cs', version = 1) {
    if (typeof text !== 'string') throw new TypeError('Source must be a string');
    this.text = text;
    this.uri = uri;
    this.version = version;
    Object.freeze(this);
  }
  get length() {
    return this.text.length;
  }
  get lineStarts() {
    if (!this.#lines) {
      const origin = this.#origin,
        text = this.text;
      this.#origin = null;
      const scan = (lines, from, to) => {
        for (let i = from; i < to; i++) {
          const c = text.charCodeAt(i);
          if (c === 13) {
            if (text.charCodeAt(i + 1) === 10) i++;
            lines.push(i + 1);
          } else if (c === 10) lines.push(i + 1);
        }
      };
      if (origin && origin.old.#lines) {
        // Derived from the previous snapshot: lines before the edit are kept, the edited lines are rescanned and the rest shifted.
        const old = origin.old.#lines,
          delta = origin.inserted - origin.deleted,
          oldEnd = origin.start + origin.deleted,
          lines = [];
        let k = 0;
        while (k < old.length && old[k] < origin.start) lines.push(old[k++]);
        if (!lines.length) lines.push(0);
        const scanned = [];
        scan(scanned, Math.max(0, origin.start - 1), Math.min(text.length, origin.start + origin.inserted + 1));
        for (const line of scanned) if (line > lines[lines.length - 1]) lines.push(line);
        while (k < old.length && old[k] <= oldEnd + 1) k++;
        for (; k < old.length; k++) {
          const line = old[k] + delta;
          if (line > lines[lines.length - 1]) lines.push(line);
        }
        this.#lines = Object.freeze(lines);
      } else {
        const lines = [0];
        scan(lines, 0, text.length);
        this.#lines = Object.freeze(lines);
      }
    }
    return this.#lines;
  }
  positionAt(offset) {
    offset = Math.max(0, Math.min(this.length, offset));
    const starts = this.lineStarts;
    let low = 0,
      high = starts.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (starts[mid] <= offset) low = mid;
      else high = mid;
    }
    return { line: low, character: offset - starts[low] };
  }
  offsetAt({ line, character }) {
    const starts = this.lineStarts;
    const n = Math.max(0, Math.min(starts.length - 1, line | 0));
    let end = n + 1 < starts.length ? starts[n + 1] : this.length;
    while (end > starts[n] && (this.text[end - 1] === '\r' || this.text[end - 1] === '\n')) end--;
    return Math.max(starts[n], Math.min(end, starts[n] + character));
  }
  withChange(start, deleteCount, insertText) {
    if (!Number.isInteger(start) || !Number.isInteger(deleteCount) || start < 0 || deleteCount < 0 || start + deleteCount > this.length)
      throw new RangeError('Invalid text change');
    const next = new SourceText(this.text.slice(0, start) + insertText + this.text.slice(start + deleteCount), this.uri, this.version + 1);
    if (this.#lines) next.#origin = { old: this, start, deleted: deleteCount, inserted: insertText.length };
    return next;
  }
}
export function diagnostic(source, start, length, code, message, severity = 'error') {
  start = Math.max(0, Math.min(source.length, start));
  return {
    uri: source.uri,
    version: source.version,
    start,
    length: Math.max(0, Math.min(source.length - start, length)),
    code,
    message,
    severity,
    range: { start: source.positionAt(start), end: source.positionAt(start + length) }
  };
}
/** Small bounded insertion-order cache. Cache lifetime belongs to a Workspace. */
export class BoundedCache {
  constructor(limit = 8192) {
    this.limit = limit;
    this.map = new Map();
  }
  getOrAdd(key, factory) {
    const old = this.map.get(key);
    if (old !== undefined) return old;
    const value = factory();
    this.map.set(key, value);
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
    return value;
  }
  clear() {
    this.map.clear();
  }
}

export * from './search.js';

export { PieceTable, PieceTableSnapshot } from './piece-table.js';
export { LineIndex } from './line-index.js';
export { TextBuffer, TextVersionError } from './buffer.js';
export { EndOfLine, analyzeEol, normalizeEol, eolEdits, decodeText, encodeText } from './eol.js';
export { GraphemeSegmenter, iterateGraphemes, graphemeSegments, nextGraphemeOffset, previousGraphemeOffset } from './graphemes.js';
export { wordSegments, subwordBoundaries, nextWordOffset, previousWordOffset, wordRangeAt } from './words.js';
export { graphemeWidth, visualColumnAt, offsetAtVisualColumn, expandTabs } from './columns.js';
export { diffLines, diffWords, diffCharacters } from './diff.js';
export { merge3 } from './merge3.js';
export { VisualColumnIndex } from './visual-column-index.js';
export { unicodeGraphemeVersion } from './graphemes.js';
