import { scanEscape } from './lexer/escapes.js';
import { runLength, rawIsMultiline, rawSegmentValue } from './lexer/raw-strings.js';
/**
 * Structured scanner for interpolated strings: `$"..."`, `$@"..."` / `@$"..."` and raw `$"""..."""`, `$$"""...{{x}}..."""`.
 * Offsets are absolute UTF-16 positions. `report(start, length, code, message)` receives errors and
 * `hole(offset, stops)` lexes one interpolation hole with the main scanner, returning { tokens, tail, end }.
 * Returns { end, parts, structure }:
 *  - `structure` is the lossless shape consumed by the parser: start/end delimiters and `segments` (text values keep
 *    doubled braces, as Roslyn's InterpolatedStringTextToken does), each either
  *    { type: 'text', start, end, value } or { type: 'hole', open, head, tokens, tail, comma, alignHead, alignTokens, alignTail, colon, formatStart,
  *    formatEnd, close }
 *    where head is trivia trailing the opening brace (or comma) and tail is trivia before the terminator.
 *  - `parts` is the flattened view kept for existing consumers: { text } or { expression, start, end, alignment, format }.
 */
export function scanInterpolated(text, start, report, hole) {
  let i = start,
    dollars = 0,
    verbatim = false;
  const features = [];
  if (text[i] === '@') {
    verbatim = true;
    i++;
    features.push('AltInterpolatedVerbatimStrings');
  }
  while (text[i] === '$') {
    dollars++;
    i++;
  }
  if (text[i] === '@') {
    verbatim = true;
    i++;
  }
  const run = runLength(text, i, '"'),
    raw = run >= 3 && !verbatim,
    quotes = raw ? run : 1,
    quoteEnd = i + quotes,
    multiline = raw && rawIsMultiline(text, quoteEnd),
    braces = raw ? dollars : 1;
  // A multi-line raw start token runs through the line break after the opening quotes; the end token starts at the line break before the closing line.
  let startEnd = quoteEnd,
    indent = '';
  if (multiline) {
    while (!/[\r\n\u0085\u2028\u2029]/.test(text[startEnd])) startEnd++;
    startEnd += text[startEnd] === '\r' && text[startEnd + 1] === '\n' ? 2 : 1;
  }
  if (raw) features.push('RawStringLiterals');
  const error = (at, message, code = 'CS8076', length = Math.max(1, i - at)) => report(at, length, code, message),
    eol = at => /[\r\n\u0085\u2028\u2029]/.test(text[at] ?? '');
  const segments = [];
  let literal = '',
    textStart = startEnd,
    closed = false,
    endStart = -1,
    broken = false,
    excess = 0;
  i = startEnd;
  const flush = end => {
    if (end > textStart) segments.push({ type: 'text', start: textStart, end, value: literal });
    literal = '';
  };
  while (i < text.length && !broken) {
    const ch = text[i];
    if (ch === '"') {
      const n = raw ? runLength(text, i, '"') : 1;
      if (raw && n < quotes) {
        i += n;
        continue;
      }
      if (!raw && verbatim && text[i + 1] === '"') {
        literal += '"';
        i += 2;
        continue;
      }
      if (raw && n > quotes)
        report(
          i,
          n,
          'CS8998',
          'The raw string literal does not start with enough quote characters to allow this many consecutive quote characters as content'
        );
      endStart = i;
      if (multiline) {
        let line = i;
        while (line > startEnd && !eol(line - 1)) line--;
        if (!/^[ \t\v\f\u00A0]*$/.test(text.slice(line, i))) report(i, n, 'CS9000', 'Raw string literal delimiter must be on its own line');
        else if (line === startEnd)
          report(start, i + n - start, 'CS9002', 'Multi-line raw string literals must contain at least one line of content');
        else {
          indent = text.slice(line, i);
          endStart = line - (text[line - 1] === '\n' && text[line - 2] === '\r' ? 2 : 1);
        }
      }
      flush(endStart);
      i += n;
      closed = true;
      break;
    }
    if (eol(i) && !verbatim && !multiline) {
      if (!raw) error(start, 'Newline in interpolated string');
      break;
    }
    if (!raw && !verbatim && ch === '\\') {
      const escape = scanEscape(text, i);
      if (escape.error) report(i, Math.max(1, escape.end - i), 'CS1009', escape.error);
      if (escape.feature) features.push(escape.feature);
      literal += escape.value;
      i = escape.end;
      continue;
    }
    if (ch === '}') {
      const n = runLength(text, i, '}');
      if (raw) {
        if (n >= braces)
          report(
            i,
            n,
            'CS9007',
            "The interpolated raw string literal does not start with enough '$' characters to allow this many consecutive closing braces as content"
          );
        i += n;
        continue;
      }
      if (n >= 2) {
        literal += '}}';
        i += 2;
        continue;
      }
      i++;
      error(i - 1, 'Closing brace must be escaped as }}');
      continue;
    }
    if (ch !== '{') {
      literal += ch;
      i++;
      continue;
    }
    if (raw) {
      const n = runLength(text, i, '{');
      if (n < braces) {
        i += n;
        continue;
      }
      if (n >= 2 * braces)
        report(
          i,
          n,
          'CS9006',
          "The interpolated raw string literal does not start with enough '$' characters to allow this many consecutive opening braces as content"
        );
      i += n - braces;
      excess = n >= 2 * braces ? n - braces : 0;
    } else if (text[i + 1] === '{') {
      literal += '{{';
      i += 2;
      continue;
    }
    flush(i);
    const segment = {
      type: 'hole',
      open: { start: i, end: i + braces },
      comma: -1,
      alignTokens: null,
      alignTail: null,
      colon: -1,
      formatStart: -1,
      formatEnd: -1,
      close: null
    };
    const expression = hole(i + braces, ',:}');
    segment.tokens = expression.tokens;
    segment.tail = expression.tail;
    segment.head = expression.head;
    segment.exprEnd = i = expression.end;
    if (expression.limit) error(i, 'Interpolation nesting limit');
    if (text[i] === ',') {
      segment.comma = i;
      const alignment = hole(i + 1, ':}');
      segment.alignTokens = alignment.tokens;
      segment.alignTail = alignment.tail;
      segment.alignHead = alignment.head;
      segment.alignEnd = i = alignment.end;
    }
    if (text[i] === ':') {
      segment.colon = i++;
      segment.formatStart = i;
      let format = '';
      while (
        i < text.length &&
        text[i] !== '}' &&
        !(text[i] === '"' && (!raw || runLength(text, i, '"') >= quotes)) &&
        !(eol(i) && !verbatim && !multiline)
      ) {
        if (text[i] === '{') error(i, 'Format specifier cannot contain {', 'CS8076', 1);
        if (text[i] === '\\' && !raw && !verbatim) {
          const escape = scanEscape(text, i);
          format += escape.value;
          i = escape.end;
        } else format += text[i++];
      }
      segment.formatEnd = i;
      segment.formatValue = format;
    }
    if (text[i] === '}' && runLength(text, i, '}') >= braces) {
      segment.close = { start: i, end: i + braces };
      i += braces;
      if (excess) {
        textStart = i;
        i += Math.min(excess, runLength(text, i, '}'));
        excess = 0;
        segments.push(segment);
        continue;
      }
    } else {
      error(segment.open.end, 'Unclosed interpolation');
      broken = true;
    }
    if (!raw && !verbatim && /[\r\n\u0085\u2028\u2029]/.test(text.slice(segment.open.end, i))) features.push('NewLinesInInterpolations');
    segments.push(segment);
    textStart = i;
    if (segments.length > 20000) {
      error(start, 'Interpolation part limit exceeded');
      broken = true;
    }
  }
  if (!closed) {
    flush(i);
    if (raw) report(start, i - start, 'CS8997', 'Unterminated raw string literal');
    else error(start, 'Unterminated interpolated string');
  }
  if (multiline) {
    for (const segment of segments)
      if (segment.type === 'text')
        segment.value = rawSegmentValue(
          text.slice(segment.start, segment.end),
          indent,
          { first: false, last: false, atLineStart: segment.start === startEnd },
          (at, length, code, message) => report(segment.start + at, length, code, message)
        );
  } else if (raw) for (const segment of segments) if (segment.type === 'text') segment.value = text.slice(segment.start, segment.end);
  const parts = [];
  for (const segment of segments) {
    if (segment.type === 'text') {
      if (segment.value) parts.push({ text: raw ? segment.value : segment.value.replaceAll('{{', '{').replaceAll('}}', '}') });
      continue;
    }
    const expressionStart = segment.open.end,
      alignmentText = segment.comma < 0 ? '0' : text.slice(segment.comma + 1, segment.alignEnd).trim(),
      align = Number(alignmentText);
    if (segment.comma >= 0 && !/^[+-]?\d+$/.test(alignmentText)) error(segment.comma, 'Alignment must be a signed integer constant', 'CS8076', 1);
    if (!Number.isInteger(align) || Math.abs(align) > 100000) error(segment.comma, 'Interpolation alignment limit exceeded', 'CS8076', 1);
    parts.push({
      expression: text.slice(expressionStart, segment.exprEnd),
      start: expressionStart,
      end: segment.exprEnd,
      alignment: Number.isInteger(align) ? align : 0,
      format: segment.colon < 0 ? '' : text.slice(segment.formatStart, segment.formatEnd)
    });
  }
  return {
    end: i,
    parts,
    structure: { start, startEnd, raw, multiline, verbatim, dollars, quotes, segments, closed, endStart: closed ? endStart : i, end: i, features }
  };
}
