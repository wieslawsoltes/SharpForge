import { scanEscape } from './lexer/escapes.js';
import { runLength, rawIsMultiline, rawSegmentValue } from './lexer/raw-strings.js';
const lineBreak = /[\r\n\u0085\u2028\u2029]/;
const tooManyQuotes = 'The raw string literal does not start with enough quote characters to allow this many consecutive quote characters as content';
const tooManyClosingBraces =
  "The interpolated raw string literal does not start with enough '$' characters to allow this many consecutive closing braces as content";
const tooManyOpeningBraces =
  "The interpolated raw string literal does not start with enough '$' characters to allow this many consecutive opening braces as content";
/**
 * One scan of an interpolated string. The state is the cursor `i`, the text segment being collected (`literal`,
 * `textStart`) and the segments found so far; each method handles one kind of character at the cursor.
 */
class InterpolatedScan {
  constructor(text, start, report, hole) {
    this.text = text;
    this.start = start;
    this.report = report;
    this.hole = hole;
    this.i = start;
    this.features = [];
    this.segments = [];
    this.literal = '';
    this.closed = false;
    this.endStart = -1;
    this.broken = false;
    this.excess = 0;
    this.indent = '';
  }
  /** Reads the `$`, `@` and quote prefix and decides the form: verbatim, raw (and how many quotes and braces), multi-line. */
  header() {
    const { text, start } = this;
    let i = start;
    this.dollars = 0;
    this.verbatim = false;
    if (text[i] === '@') {
      this.verbatim = true;
      i++;
      // `@$"` is the C# 8 spelling; Roslyn reports it over these three characters.
      this.features.push({ id: 'AltInterpolatedVerbatimStrings', start, end: start + 3 });
    }
    while (text[i] === '$') {
      this.dollars++;
      i++;
    }
    if (text[i] === '@') {
      this.verbatim = true;
      i++;
    }
    const run = runLength(text, i, '"');
    this.raw = run >= 3 && !this.verbatim;
    this.quotes = this.raw ? run : 1;
    this.multiline = this.raw && rawIsMultiline(text, i + this.quotes);
    this.braces = this.raw ? this.dollars : 1;
    // A multi-line raw start token runs through the line break after the opening quotes; the end token starts at the line break before the closing line.
    let startEnd = i + this.quotes;
    if (this.multiline) {
      while (!lineBreak.test(text[startEnd])) startEnd++;
      startEnd += text[startEnd] === '\r' && text[startEnd + 1] === '\n' ? 2 : 1;
    }
    if (this.raw) this.features.push('RawStringLiterals');
    this.startEnd = this.textStart = this.i = startEnd;
  }
  /** Reports an interpolation error; by default it runs from `at` to the cursor. */
  error(at, message, code = 'CS8076', length = Math.max(1, this.i - at)) {
    this.report(at, length, code, message);
  }
  eol(at) {
    return lineBreak.test(this.text[at] ?? '');
  }
  /** True when a line break at `at` ends the literal (it does not in verbatim and multi-line raw strings). */
  endsLiteral(at) {
    return this.eol(at) && !this.verbatim && !this.multiline;
  }
  /** Ends the current text segment at `end`. */
  flush(end) {
    if (end > this.textStart) this.segments.push({ type: 'text', start: this.textStart, end, value: this.literal });
    this.literal = '';
  }
  /** Scans text and holes up to the closing quote, a line break that ends the literal, or the end of the input. */
  body() {
    const text = this.text,
      escapes = !this.raw && !this.verbatim;
    while (this.i < text.length && !this.broken) {
      const ch = text[this.i];
      if (ch === '"') {
        if (this.quote()) break;
      } else if (this.endsLiteral(this.i)) {
        if (!this.raw) this.error(this.start, 'Newline in interpolated string');
        break;
      } else if (ch === '\\' && escapes) this.escape();
      else if (ch === '}') this.closingBraces();
      else if (ch !== '{') {
        this.literal += ch;
        this.i++;
      } else if (this.openingBraces()) this.holeSegment();
    }
  }
  /** A `"` at the cursor: content (a doubled quote, or too few quotes in a raw string) or the closing delimiter. Returns true when it closes. */
  quote() {
    const { text, raw, quotes, i } = this,
      n = raw ? runLength(text, i, '"') : 1;
    if (raw && n < quotes) {
      this.i += n;
      return false;
    }
    if (!raw && this.verbatim && text[i + 1] === '"') {
      this.literal += '"';
      this.i += 2;
      return false;
    }
    if (raw && n > quotes) this.report(i, n, 'CS8998', tooManyQuotes);
    this.endStart = i;
    if (this.multiline) this.closingLine(i, n);
    this.flush(this.endStart);
    this.i += n;
    this.closed = true;
    return true;
  }
  /** The closing delimiter of a multi-line raw string must stand alone on its line; its indentation is removed from every content line. */
  closingLine(quote, n) {
    const text = this.text;
    let line = quote;
    while (line > this.startEnd && !this.eol(line - 1)) line--;
    if (!/^[ \t\v\f\u00A0]*$/.test(text.slice(line, quote))) this.report(quote, n, 'CS9000', 'Raw string literal delimiter must be on its own line');
    else if (line === this.startEnd)
      this.report(this.start, quote + n - this.start, 'CS9002', 'Multi-line raw string literals must contain at least one line of content');
    else {
      this.indent = text.slice(line, quote);
      this.endStart = line - (text[line - 1] === '\n' && text[line - 2] === '\r' ? 2 : 1);
    }
  }
  escape() {
    const escape = scanEscape(this.text, this.i);
    if (escape.error) this.report(this.i, Math.max(1, escape.end - this.i), 'CS1009', escape.error);
    if (escape.feature) this.features.push(escape.feature);
    this.literal += escape.value;
    this.i = escape.end;
  }
  /** `}` in text: `}}` is an escaped brace; in a raw string fewer braces than `$` signs are content. */
  closingBraces() {
    const n = runLength(this.text, this.i, '}');
    if (this.raw) {
      if (n >= this.braces) this.report(this.i, n, 'CS9007', tooManyClosingBraces);
      this.i += n;
    } else if (n >= 2) {
      this.literal += '}}';
      this.i += 2;
    } else {
      this.i++;
      this.error(this.i - 1, 'Closing brace must be escaped as }}');
    }
  }
  /** `{` in text. Returns true when a hole starts at the cursor (after any extra braces of a raw string), false when the braces were content. */
  openingBraces() {
    if (!this.raw) {
      if (this.text[this.i + 1] !== '{') return true;
      this.literal += '{{';
      this.i += 2;
      return false;
    }
    const n = runLength(this.text, this.i, '{'),
      braces = this.braces;
    if (n < braces) {
      this.i += n;
      return false;
    }
    if (n >= 2 * braces) this.report(this.i, n, 'CS9006', tooManyOpeningBraces);
    this.i += n - braces;
    this.excess = n >= 2 * braces ? n - braces : 0;
    return true;
  }
  /** A hole at the cursor: `{expression[, alignment][: format]}`. The expression and alignment are lexed by the main scanner. */
  holeSegment() {
    this.flush(this.i);
    const text = this.text,
      braces = this.braces;
    const segment = {
      type: 'hole',
      open: { start: this.i, end: this.i + braces },
      comma: -1,
      alignTokens: null,
      alignTail: null,
      colon: -1,
      formatStart: -1,
      formatEnd: -1,
      close: null
    };
    const expression = this.hole(this.i + braces, ',:}');
    segment.tokens = expression.tokens;
    segment.tail = expression.tail;
    segment.head = expression.head;
    segment.exprEnd = this.i = expression.end;
    if (expression.limit) this.error(this.i, 'Interpolation nesting limit');
    if (text[this.i] === ',') {
      segment.comma = this.i;
      const alignment = this.hole(this.i + 1, ':}');
      segment.alignTokens = alignment.tokens;
      segment.alignTail = alignment.tail;
      segment.alignHead = alignment.head;
      segment.alignEnd = this.i = alignment.end;
    }
    if (text[this.i] === ':') this.format(segment);
    this.closeHole(segment);
  }
  /** The format clause after `:`; it runs to the closing brace, the closing quote or a line break that ends the literal. */
  format(segment) {
    const text = this.text,
      escapes = !this.raw && !this.verbatim;
    segment.colon = this.i++;
    segment.formatStart = this.i;
    let format = '';
    while (this.i < text.length && text[this.i] !== '}' && !this.atClosingQuote() && !this.endsLiteral(this.i)) {
      if (text[this.i] === '{') this.error(this.i, 'Format specifier cannot contain {', 'CS8076', 1);
      if (text[this.i] === '\\' && escapes) {
        const escape = scanEscape(text, this.i);
        format += escape.value;
        this.i = escape.end;
      } else format += text[this.i++];
    }
    segment.formatEnd = this.i;
    segment.formatValue = format;
  }
  atClosingQuote() {
    return this.text[this.i] === '"' && (!this.raw || runLength(this.text, this.i, '"') >= this.quotes);
  }
  /** The closing brace(s) of a hole, or the error for a hole that is not closed. */
  closeHole(segment) {
    const text = this.text,
      braces = this.braces;
    if (text[this.i] === '}' && runLength(text, this.i, '}') >= braces) {
      segment.close = { start: this.i, end: this.i + braces };
      this.i += braces;
      if (this.excess) {
        // The extra braces reported with CS9006 are content: the next text segment starts with their closing counterparts.
        this.textStart = this.i;
        this.i += Math.min(this.excess, runLength(text, this.i, '}'));
        this.excess = 0;
        this.segments.push(segment);
        return;
      }
    } else {
      this.error(segment.open.end, 'Unclosed interpolation');
      this.broken = true;
    }
    if (!this.raw && !this.verbatim && lineBreak.test(text.slice(segment.open.end, this.i)))
      this.features.push({ id: 'NewLinesInInterpolations', start: segment.close?.start ?? this.i, end: segment.close?.end ?? this.i });
    this.segments.push(segment);
    this.textStart = this.i;
    if (this.segments.length > 20000) {
      this.error(this.start, 'Interpolation part limit exceeded');
      this.broken = true;
    }
  }
  /** Reports an unterminated literal and computes the values of raw text segments (indentation removed for multi-line ones). */
  finish() {
    const { text, start, raw } = this;
    if (!this.closed) {
      this.flush(this.i);
      if (raw) this.report(start, this.i - start, 'CS8997', 'Unterminated raw string literal');
      else this.error(start, 'Unterminated interpolated string');
    }
    if (!raw) return;
    for (const segment of this.segments) {
      if (segment.type !== 'text') continue;
      const content = text.slice(segment.start, segment.end);
      if (!this.multiline) segment.value = content;
      else {
        const position = { first: false, last: false, atLineStart: segment.start === this.startEnd };
        segment.value = rawSegmentValue(content, this.indent, position, (at, length, code, message) =>
          this.report(segment.start + at, length, code, message)
        );
      }
    }
  }
  /** The flattened view kept for existing consumers: { text } or { expression, start, end, alignment, format }. */
  parts() {
    const { text, raw } = this,
      parts = [];
    for (const segment of this.segments) {
      if (segment.type === 'text') {
        if (segment.value) parts.push({ text: raw ? segment.value : segment.value.replaceAll('{{', '{').replaceAll('}}', '}') });
        continue;
      }
      const expressionStart = segment.open.end,
        alignmentText = segment.comma < 0 ? '0' : text.slice(segment.comma + 1, segment.alignEnd).trim(),
        // The alignment is any expression; whether it is an int constant in range is the binder's question (CS0150, CS8094).
        // This flattened view carries a number, so it holds the value of an integer literal and 0 for anything else.
        align = /^[+-]?\d+$/.test(alignmentText) ? Number(alignmentText) : 0;
      parts.push({
        expression: text.slice(expressionStart, segment.exprEnd),
        start: expressionStart,
        end: segment.exprEnd,
        alignment: align,
        format: segment.colon < 0 ? '' : text.slice(segment.formatStart, segment.formatEnd)
      });
    }
    return parts;
  }
  /** The lossless shape consumed by the parser. */
  structure() {
    const { start, startEnd, raw, multiline, verbatim, dollars, quotes, segments, closed, features } = this;
    return { start, startEnd, raw, multiline, verbatim, dollars, quotes, segments, closed, endStart: closed ? this.endStart : this.i, end: this.i, features };
  }
}
/**
 * Structured scanner for interpolated strings: `$"..."`, `$@"..."` / `@$"..."` and raw `$"""..."""`, `$$"""...{{x}}..."""`.
 * Offsets are absolute UTF-16 positions. `report(start, length, code, message)` receives errors and
 * `hole(offset, stops)` lexes one interpolation hole with the main scanner, returning { tokens, tail, end }.
 * Returns { end, parts, structure }:
 *  - `structure` is the lossless shape consumed by the parser: start/end delimiters and `segments` (text values keep
 *    doubled braces, as Roslyn's InterpolatedStringTextToken does), each either
 *    { type: 'text', start, end, value } or { type: 'hole', open, head, tokens, tail, comma, alignHead, alignTokens,
 *    alignTail, colon, formatStart, formatEnd, close }
 *    where head is trivia trailing the opening brace (or comma) and tail is trivia before the terminator.
 *  - `parts` is the flattened view kept for existing consumers: { text } or { expression, start, end, alignment, format }.
 */
export function scanInterpolated(text, start, report, hole) {
  const scan = new InterpolatedScan(text, start, report, hole);
  scan.header();
  scan.body();
  scan.finish();
  const parts = scan.parts();
  return { end: scan.i, parts, structure: scan.structure() };
}
