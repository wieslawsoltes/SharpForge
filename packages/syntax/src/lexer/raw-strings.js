/** Raw string literals (C# 11): `"""` delimiters of any length, single-line and multi-line with closing-line indentation removal. */
const newline = /\r\n|[\r\n\u0085\u2028\u2029]/g, blank = /^[ \t\v\f\u00A0]*$/;
const describe = ws => ws ? [...ws].map(c => c === '\t' ? '\\t' : c === ' ' ? ' ' : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('') : '';
/** Number of consecutive `ch` characters at `i`. */
export function runLength(text, i, ch) { let n = 0; while (text[i + n] === ch) n++; return n; }
/** True when the opening delimiter ending at `i` starts a multi-line raw literal (only whitespace up to the line break). */
export function rawIsMultiline(text, i) { while (/[ \t\v\f\u00A0]/.test(text[i] ?? '')) i++; return i < text.length && /[\r\n\u0085\u2028\u2029]/.test(text[i]); }
/**
 * Removes the closing-line indentation from one text segment of a multi-line raw literal.
 * `first` strips the line break after the opening delimiter, `last` the line break before the closing line;
 * `atLineStart` says whether the segment begins a line (false after an interpolation hole).
 * `report(offsetInSegment, length, code, message)` receives CS8999, CS9002 and CS9003.
 */
export function rawSegmentValue(segment, indent, { first = true, last = true, atLineStart = first } = {}, report = () => {}) {
  let text = segment, base = 0;
  if (first) { const open = /^[ \t\v\f\u00A0]*(\r\n|[\r\n\u0085\u2028\u2029])/.exec(text); if (open) { base = open[0].length; text = text.slice(base); } }
  if (last) {
    const close = /(\r\n|[\r\n\u0085\u2028\u2029])[ \t\v\f\u00A0]*$/.exec(text);
    if (close) text = text.slice(0, close.index); else if (first) { report(0, segment.length, 'CS9002', 'Multi-line raw string literals must contain at least one line of content'); return ''; } else text = text.replace(/[ \t\v\f\u00A0]*$/, '');
  }
  let out = '', at = 0, lineStart = atLineStart; newline.lastIndex = 0;
  for (;;) {
    const match = newline.exec(text), end = match ? match.index : text.length; let line = text.slice(at, end);
    if (lineStart && indent) {
      const ws = /^[ \t\v\f\u00A0]*/.exec(line)[0], isBlank = blank.test(line) && (match || last);
      if (line.startsWith(indent)) line = line.slice(indent.length);
      else if (isBlank && indent.startsWith(line)) line = '';
      else if (indent.startsWith(ws) || ws.startsWith(indent.slice(0, ws.length)) && ws.length < indent.length) report(base + at, Math.max(1, ws.length), 'CS8999', 'Line does not start with the same whitespace as the closing line of the raw string literal');
      else { let k = 0; while (ws[k] === indent[k]) k++; report(base + at, Math.max(1, ws.length), 'CS9003', `Line contains different whitespace than the closing line of the raw string literal: '${describe(ws[k])}' versus '${describe(indent[k])}'`); }
    }
    out += line; if (!match) break; out += match[0]; at = match.index + match[0].length; lineStart = true;
  }
  return out;
}
/**
 * Scans a non-interpolated raw string literal starting at its first quote.
 * Returns { end, value, multiline, closed, quotes }.
 */
export function scanRawString(text, start, report) {
  const quotes = runLength(text, start, '"'), open = start + quotes, multiline = rawIsMultiline(text, open); let i = open;
  if (!multiline) {
    while (i < text.length && !/[\r\n\u0085\u2028\u2029]/.test(text[i])) {
      const run = text[i] === '"' ? runLength(text, i, '"') : 0;
      if (run >= quotes) { if (run > quotes) report(i, run, 'CS8998', 'The raw string literal does not start with enough quote characters to allow this many consecutive quote characters as content'); return { end: i + run, value: text.slice(open, i), multiline, closed: true, quotes }; }
      i += run || 1;
    }
    report(start, i - start, 'CS8997', 'Unterminated raw string literal');
    return { end: i, value: text.slice(open, i), multiline, closed: false, quotes };
  }
  for (; i < text.length; i++) {
    if (text[i] !== '"') continue;
    const run = runLength(text, i, '"'); if (run < quotes) { i += run - 1; continue; }
    let lineStart = i; while (lineStart > open && !/[\r\n\u0085\u2028\u2029]/.test(text[lineStart - 1])) lineStart--;
    const indent = text.slice(lineStart, i);
    if (!blank.test(indent)) { report(i, run, 'CS9000', 'Raw string literal delimiter must be on its own line'); return { end: i + run, value: text.slice(open, i), multiline, closed: true, quotes }; }
    if (run > quotes) report(i, run, 'CS8998', 'The raw string literal does not start with enough quote characters to allow this many consecutive quote characters as content');
    return { end: i + run, value: rawSegmentValue(text.slice(open, i), indent, {}, (at, length, code, message) => report(open + at, length, code, message)), multiline, closed: true, quotes };
  }
  report(start, text.length - start, 'CS8997', 'Unterminated raw string literal');
  return { end: text.length, value: text.slice(open), multiline, closed: false, quotes };
}
