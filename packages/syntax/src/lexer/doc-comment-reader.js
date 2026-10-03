import { GreenNode, GreenToken, GreenTrivia, GreenFlags } from '../green.js';
/**
 * The character reader under the documentation comment parser: it turns the comment text into green tokens, trivia
 * and nodes, tracks the comment exterior (`///`, `/**`, ` *`, `*\/`) as trivia, and collects warnings. Everything it
 * consumes ends up in a token or a trivia, so the finished structure reproduces the comment text.
 */
const empty = Object.freeze([]);
export const xmlEntities = Object.freeze({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" });
export const isSpace = ch => ch === ' ' || ch === '\t';
/** Length of the line break at `i`, or 0. */
export const eol = (text, i) => {
  const ch = text[i];
  if (ch === '\r') return text[i + 1] === '\n' ? 2 : 1;
  return ch === '\n' || ch === '\u0085' || ch === '\u2028' || ch === '\u2029' ? 1 : 0;
};
export class DocumentationCommentReader {
  constructor(text, kind) {
    this.text = text;
    this.kind = kind;
    this.single = kind === 'SingleLineDocumentationCommentTrivia';
    this.i = 0;
    this.pending = [];
    this.diagnostics = [];
    this.depth = 0;
    this.limit = !this.single && text.length >= 5 && text.endsWith('*/') ? text.length - 2 : text.length;
  }
  warn(start, end, code = 'CS1570', message = 'XML comment has badly formed XML') {
    if (this.diagnostics.length < 64) this.diagnostics.push({ code, start, end, message, severity: 'warning' });
  }
  trivia(kind, start, end) {
    if (end > start) this.pending.push(new GreenTrivia(kind, this.text.slice(start, end)));
  }
  /** Consumes `length` characters as one token carrying the pending trivia. */
  take(kind, length, value) {
    const start = this.i,
      leading = this.pending.length ? Object.freeze(this.pending) : empty;
    this.pending = [];
    this.i = start + length;
    return new GreenToken(kind, this.text.slice(start, this.i), value, leading);
  }
  missing(kind) {
    return new GreenToken(kind, '', undefined, empty, empty, GreenFlags.Missing);
  }
  node(kind, ...children) {
    return new GreenNode(
      kind,
      children.map(child => (Array.isArray(child) ? (child.length ? new GreenNode('SyntaxList', child) : null) : (child ?? null)))
    );
  }
  at(s) {
    return this.i + s.length <= this.limit && this.text.startsWith(s, this.i);
  }
  get done() {
    return this.i >= this.limit;
  }
  /** The comment exterior at a line start: `///` (with its indentation), `/**`, or the indentation and optional `*` of a delimited comment line. */
  exterior() {
    const text = this.text;
    let j = this.i;
    if (this.single || j === 0) {
      while (isSpace(text[j])) j++;
      if (text.startsWith(this.single ? '///' : '/**', j)) {
        this.trivia('DocumentationCommentExteriorTrivia', this.i, j + 3);
        this.i = j + 3;
      }
      return;
    }
    while (j < this.limit && isSpace(text[j])) j++;
    if (j < this.limit && text[j] === '*') j++;
    this.trivia('DocumentationCommentExteriorTrivia', this.i, j);
    this.i = j;
  }
  /** Text, newline and entity tokens up to the first offset where `stop` holds. In `raw` mode (CDATA, comments, PIs) `&` and `<` are plain text. */
  textTokens(stop, raw) {
    const text = this.text,
      out = [];
    while (!this.done && !stop(this.i)) {
      const n = eol(text, this.i);
      if (n) {
        out.push(this.take('XmlTextLiteralNewLineToken', n, text.slice(this.i, this.i + n)));
        this.exterior();
        continue;
      }
      if (!raw && text[this.i] === '&') {
        const m = /^&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|([A-Za-z]+));/.exec(text.slice(this.i, this.i + 12)),
          code = m ? (m[1] ? Number(m[1]) : m[2] ? parseInt(m[2], 16) : -1) : -1;
        const value = !m ? undefined : code >= 0 ? (code <= 0x10ffff && code > 0 ? String.fromCodePoint(code) : undefined) : xmlEntities[m[3]];
        if (value !== undefined) {
          out.push(this.take('XmlEntityLiteralToken', m[0].length, value));
          continue;
        }
        this.warn(this.i, this.i + 1);
      } else if (!raw && text[this.i] === '<') this.warn(this.i, this.i + 1);
      let j = this.i + 1;
      while (j < this.limit && !eol(text, j) && !stop(j) && (raw || (text[j] !== '&' && text[j] !== '<'))) j++;
      out.push(this.take('XmlTextLiteralToken', j - this.i, text.slice(this.i, j)));
    }
    return out;
  }
}
