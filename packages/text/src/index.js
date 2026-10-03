/** Immutable UTF-16 source snapshots; positions use the same units as browser editors/LSP. */
export class SourceText {
  #lines;
  constructor(text, uri = 'Program.cs', version = 1) {
    if (typeof text !== 'string') throw new TypeError('Source must be a string');
    this.text = text; this.uri = uri; this.version = version;
    Object.freeze(this);
  }
  get length() { return this.text.length; }
  get lineStarts() {
    if (!this.#lines) {
      const lines = [0];
      for (let i = 0; i < this.text.length; i++) {
        if (this.text[i] === '\r') { if (this.text[i + 1] === '\n') i++; lines.push(i + 1); }
        else if (this.text[i] === '\n') lines.push(i + 1);
      }
      this.#lines = Object.freeze(lines);
    }
    return this.#lines;
  }
  positionAt(offset) {
    offset = Math.max(0, Math.min(this.length, offset));
    const starts = this.lineStarts; let low = 0, high = starts.length;
    while (low + 1 < high) { const mid = (low + high) >>> 1; if (starts[mid] <= offset) low = mid; else high = mid; }
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
    if (!Number.isInteger(start) || !Number.isInteger(deleteCount) || start < 0 || deleteCount < 0 || start + deleteCount > this.length) throw new RangeError('Invalid text change');
    return new SourceText(this.text.slice(0, start) + insertText + this.text.slice(start + deleteCount), this.uri, this.version + 1);
  }
}
export function diagnostic(source, start, length, code, message, severity = 'error') {
  start = Math.max(0, Math.min(source.length, start));
  return { uri: source.uri, version: source.version, start, length: Math.max(0, Math.min(source.length - start, length)), code, message, severity,
    range: { start: source.positionAt(start), end: source.positionAt(start + length) } };
}
/** Small bounded insertion-order cache. Cache lifetime belongs to a Workspace. */
export class BoundedCache {
  constructor(limit = 8192) { this.limit = limit; this.map = new Map(); }
  getOrAdd(key, factory) {
    const old = this.map.get(key); if (old !== undefined) return old;
    const value = factory(); this.map.set(key, value);
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
    return value;
  }
  clear() { this.map.clear(); }
}

export * from "./search.js";
