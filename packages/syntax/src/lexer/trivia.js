import { scanConditionalDirective, scanDisabledText, snapshotDirectiveState } from '../directives/conditional.js';
import { scanMiscDirective } from '../directives/misc.js';
import { scanScriptDirective } from '../directives/script.js';
/** Trivia scanning: whitespace, end-of-line, comments, documentation comments, directives and disabled text. */
const whitespace = /[\t\v\f\x1A\xA0\p{Zs}]/u,
  BOM = String.fromCharCode(0xfeff);
export function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || (ch !== undefined && (ch === BOM || whitespace.test(ch)));
}
const none = Object.freeze([]);
const NEL = String.fromCharCode(0x85),
  LS = String.fromCharCode(0x2028),
  PS = String.fromCharCode(0x2029);
/** Length of the line break at `i` (2 for CRLF, 1 for CR, LF, U+0085, U+2028, U+2029), or 0. */
export function endOfLineLength(text, i) {
  const ch = text[i];
  if (ch === '\r') return text[i + 1] === '\n' ? 2 : 1;
  return ch === '\n' || ch === NEL || ch === LS || ch === PS ? 1 : 0;
}
const lineEnd = (text, i) => {
  while (i < text.length && !endOfLineLength(text, i)) i++;
  return i;
};
const structural = new Set(['if', 'elif', 'else', 'endif', 'region', 'endregion']);
/** Lexes the directive whose `#` is at `hash`. The trivia runs from `#` through the line break. Inactive directives keep their structure but have no effect. */
function directive(s, hash) {
  const text = s.text,
    stop = lineEnd(text, hash),
    end = stop + endOfLineLength(text, stop),
    body = text.slice(hash + 1, stop),
    features = [];
  const marker = body[0] === '!' || body[0] === ':' ? body[0] : null,
    name = marker ? null : /^[ \t]*([A-Za-z_]\w*)?/.exec(body);
  const word = name?.[1] ?? '',
    rest = marker ? body.slice(1) : body.slice(name[0].length),
    active = s.state.active;
  const context = {
    offset: hash,
    seenToken: s.state.seenToken,
    afterIf: s.state.sawIf,
    script: !!s.options.script,
    fileBasedProgram: s.options.fileBasedProgram
  };
  const result = (marker || word === 'r' || word === 'load' ? scanScriptDirective(marker, word, rest, context) : null) ??
    scanConditionalDirective(word, rest, s.state) ??
    scanMiscDirective(word, rest, features, 1 + body.length - rest.length) ?? {
      kind: 'BadDirectiveTrivia',
      structure: { directive: word || null },
      diagnostics: [['CS1024', 'Preprocessor directive expected']],
      unknown: true
    };
  if (word === 'if') s.state.sawIf = true;
  const structure = Object.freeze({ isActive: active, ...result.structure }),
    piece = Object.freeze({ kind: result.kind ?? 'BadDirectiveTrivia', start: hash, end, structure });
  if (active || structural.has(word) || result.unknown)
    // A directive diagnostic covers the whole directive unless it names its own [offset, length] within it.
    for (const [code, message, severity, span] of result.diagnostics)
      s.error(hash + (span?.[0] ?? 0), span?.[1] ?? stop - hash, code, message, severity);
  // A directive's feature is reported at its name (`pragma`, `nullable`), as in Roslyn.
  const nameStart = stop - rest.length - word.length;
  if (active) for (const id of features) s.feature(id, word ? nameStart : hash, word ? nameStart + word.length : stop);
  s.directives.push(piece);
  s.checkpoints.push({ start: hash, end, state: (s.lastSnapshot = snapshotDirectiveState(s.state, s.lastSnapshot)) });
  s.i = end;
  return piece;
}
/**
 * One run of trivia being scanned: the pieces collected so far, the list the next piece goes to (trailing until the
 * first end-of-line, leading after it) and whether the cursor is at the start of a line (where a directive may stand).
 */
class TriviaRun {
  constructor(scanner, trailingMode) {
    const text = scanner.text;
    this.s = scanner;
    this.trailing = [];
    this.leading = [];
    this.out = trailingMode ? this.trailing : this.leading;
    this.lineStart = !trailingMode && (scanner.i === 0 || !!endOfLineLength(text, scanner.i - 1));
  }
  push(kind, start, end) {
    this.out.push(Object.freeze({ kind, start, end }));
  }
  endOfLine(i, length) {
    this.s.i += length;
    this.push('EndOfLineTrivia', i, this.s.i);
    this.out = this.leading;
    this.lineStart = true;
  }
  whitespace(i) {
    const text = this.s.text;
    let j = i + 1;
    for (;;) {
      const d = text.charCodeAt(j);
      if (d === 32 || d === 9 || ((d > 126 || d < 32) && isWhitespace(text[j]))) j++;
      else break;
    }
    this.s.i = j;
    this.push('WhitespaceTrivia', i, j);
  }
  /** `//` to the end of the line; consecutive `///` lines form one documentation comment, which is always leading trivia. */
  lineComment(i) {
    const s = this.s,
      text = s.text;
    if (text[i + 2] !== '/' || text[i + 3] === '/') {
      s.i = lineEnd(text, i);
      this.push('SingleLineCommentTrivia', i, s.i);
      this.lineStart = false;
      return;
    }
    this.out = this.leading;
    for (;;) {
      s.i = lineEnd(text, s.i);
      s.i += endOfLineLength(text, s.i);
      let j = s.i;
      while (isWhitespace(text[j])) j++;
      if (text.startsWith('///', j) && text[j + 3] !== '/') s.i = j;
      else break;
    }
    this.push('SingleLineDocumentationCommentTrivia', i, s.i);
    this.lineStart = !!endOfLineLength(text, s.i - 1);
  }
  /** A block comment; `/**` (but not `/***` or the empty comment) is a documentation comment and leading trivia. */
  blockComment(i) {
    const s = this.s,
      text = s.text,
      close = text.indexOf('*/', i + 2),
      doc = text[i + 2] === '*' && text[i + 3] !== '*' && text[i + 3] !== '/';
    if (close < 0) {
      s.i = text.length;
      s.error(i, s.i - i, 'CS1035', 'End-of-file found, */ expected');
    } else s.i = close + 2;
    if (doc) this.out = this.leading;
    this.push(doc ? 'MultiLineDocumentationCommentTrivia' : 'MultiLineCommentTrivia', i, s.i);
    this.lineStart = false;
  }
  /** `#` at the cursor: a directive when it is the first thing on its line (then leading trivia), otherwise skipped with CS1040. */
  hash(i) {
    const s = this.s,
      text = s.text;
    if (!this.lineStart) {
      const stop = lineEnd(text, i);
      s.i = stop + endOfLineLength(text, stop);
      s.error(i, 1, 'CS1040', 'Preprocessor directives must appear as the first non-whitespace character on a line');
      this.push('SkippedTokensTrivia', i, s.i);
      return;
    }
    this.out = this.leading;
    this.leading.push(directive(s, i));
    this.lineStart = true;
    if (s.state.active) return;
    const from = s.i;
    s.i = scanDisabledText(text, from);
    if (s.i > from) this.push('DisabledTextTrivia', from, s.i);
  }
}
/**
 * Scans the trivia at `s.i`. In trailing mode (directly after a token) pieces up to and including the first
 * end-of-line belong to the previous token, as in Roslyn; a documentation comment or directive ends the trailing
 * trivia early. Returns { trailing, leading } lists of frozen { kind, start, end, structure? } pieces.
 */
export function scanTrivia(s, trailingMode) {
  const text = s.text,
    first = text.charCodeAt(s.i);
  if (first > 32 && first < 127 && first !== 47 && first !== 35) return { trailing: none, leading: none };
  const run = new TriviaRun(s, trailingMode);
  for (;;) {
    const i = s.i,
      code = text.charCodeAt(i);
    if (i >= text.length) break;
    if (code > 32 && code < 127 && code !== 47 && code !== 35) break;
    const ch = text[i],
      eol = code === 32 || code === 9 ? 0 : endOfLineLength(text, i);
    if (eol) run.endOfLine(i, eol);
    else if (code === 32 || code === 9 || isWhitespace(ch)) run.whitespace(i);
    else if (ch === '/' && text[i + 1] === '/') run.lineComment(i);
    else if (ch === '/' && text[i + 1] === '*') run.blockComment(i);
    else if (ch === '#' && s.options.directives !== false) run.hash(i);
    else break;
  }
  return { trailing: run.trailing, leading: run.leading };
}
