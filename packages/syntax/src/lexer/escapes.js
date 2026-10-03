/** The one escape table shared by regular, character and interpolated literals. */
export const simpleEscapes = Object.freeze({ "'": "'", '"': '"', '\\': '\\', '0': '\0', a: '\x07', b: '\b', e: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' });
const hex = /^[\da-fA-F]+$/;
/**
 * Scans one escape sequence; `at` is the offset of the backslash.
 * Returns { end, value, error?, feature? }. On error `value` keeps the escaped character so text is never lost.
 */
export function scanEscape(text, at) {
  const ch = text[at + 1];
  if (ch === undefined) return { end: at + 1, value: '', error: 'Unrecognized escape sequence' };
  if (Object.hasOwn(simpleEscapes, ch)) return { end: at + 2, value: simpleEscapes[ch], feature: ch === 'e' ? 'StringEscapeCharacter' : undefined };
  if (ch === 'u' || ch === 'U') {
    const length = ch === 'u' ? 4 : 8, digits = text.slice(at + 2, at + 2 + length);
    if (digits.length !== length || !hex.test(digits)) { let end = at + 2; while (end < at + 2 + length && /[\da-fA-F]/.test(text[end] ?? '')) end++; return { end, value: '', error: 'Invalid Unicode escape' }; }
    const code = parseInt(digits, 16);
    if (code > 0x10FFFF) return { end: at + 2 + length, value: '', error: 'Unicode escape exceeds U+10FFFF' };
    return { end: at + 2 + length, value: ch === 'u' ? String.fromCharCode(code) : String.fromCodePoint(code) };
  }
  if (ch === 'x') {
    let end = at + 2; while (end < at + 6 && /[\da-fA-F]/.test(text[end] ?? '')) end++;
    if (end === at + 2) return { end, value: '', error: 'Invalid hexadecimal escape' };
    return { end, value: String.fromCharCode(parseInt(text.slice(at + 2, end), 16)) };
  }
  if (ch === '\r' || ch === '\n') return { end: at + 1, value: '', error: 'Unrecognized escape sequence' };
  return { end: at + 2, value: ch, error: 'Unrecognized escape sequence' };
}
