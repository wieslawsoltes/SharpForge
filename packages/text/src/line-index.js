import { PieceTable, PieceTableSnapshot } from './piece-table.js';

/** Balanced incremental line index, sharing the piece tree's CR/LF/CRLF summaries. Lines and characters are zero based. */
export class LineIndex {
  #table;
  constructor(text = '') {
    this.#table = text instanceof PieceTable ? text : new PieceTable(text);
  }
  get lineCount() { return this.#table.lineCount; }
  get length() { return this.#table.length; }
  get lineStarts() { return this.#table.snapshot().lineStarts; }
  positionAt(offset) { return this.#table.positionAt(offset); }
  offsetAt(position) { return this.#table.offsetAt(position); }
  lineStart(line) { return this.#table.snapshot().lineStart(line); }
  lineEnd(line, includeEol = false) { return this.#table.snapshot().lineEnd(line, includeEol); }
  getLine(line, options) { return this.#table.getLine(line, options); }
  applyChange(start, deleteCount, text) {
    this.#table.replace(start, deleteCount, text);
    return this;
  }
  reset(snapshot) {
    if (!(snapshot instanceof PieceTableSnapshot)) throw new TypeError('Expected a piece-table snapshot');
    this.#table.restore(snapshot);
  }
  snapshot() { return this.#table.snapshot(); }
}
