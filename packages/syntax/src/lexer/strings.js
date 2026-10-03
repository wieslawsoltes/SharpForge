import { scanEscape } from './escapes.js';
/**
 * Scans a regular string, verbatim string or character literal starting at `"`, `@"` or `'`.
 * `report(start, length, code, message)` receives lexical errors. Returns { end, kind, value, verbatim, closed, features }.
 */
export function scanString(text, start, report) {
  let i = start,
    value = '',
    closed = false;
  const features = [],
    verbatim = text[i] === '@';
  if (verbatim) i++;
  const quote = text[i++];
  while (i < text.length) {
    const ch = text[i];
    if (ch === quote) {
      i++;
      if (verbatim && text[i] === '"') {
        value += '"';
        i++;
        continue;
      }
      closed = true;
      break;
    }
    if (!verbatim && (ch === '\n' || ch === '\r' || ch === '\u0085' || ch === '\u2028' || ch === '\u2029')) break;
    if (!verbatim && ch === '\\') {
      const escape = scanEscape(text, i);
      if (escape.error) report(i, Math.max(1, escape.end - i), 'CS1009', escape.error);
      if (escape.feature) features.push({ id: escape.feature, start: i, end: escape.end });
      value += escape.value;
      i = escape.end;
      continue;
    }
    value += ch;
    i++;
  }
  if (!closed) report(start, i - start, 'CS1010', 'Newline or end of file in constant');
  const kind = quote === "'" ? 'char' : 'string';
  if (kind === 'char' && closed && value.length === 0) report(start, i - start, 'CS1011', 'Empty character literal');
  else if (kind === 'char' && value.length !== 1) report(start, i - start, 'CS1012', 'Character literal must contain one UTF-16 character');
  return { end: i, kind, value, verbatim, closed, features };
}
