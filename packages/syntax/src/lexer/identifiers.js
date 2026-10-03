/** Identifier scanning per the C# lexical grammar: Unicode classes, \u/\U escapes, formatting characters and @-verbatim names. */
const startClass = /[\p{L}\p{Nl}_]/u, partClass = /[\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}\p{Cf}]/u, formatting = /\p{Cf}/u;
export function isIdentifierStart(ch) { return ch !== undefined && startClass.test(ch); }
export function isIdentifierPart(ch) { return ch !== undefined && partClass.test(ch); }
function escapeAt(text, i) {
  if (text[i] !== '\\' || text[i + 1] !== 'u' && text[i + 1] !== 'U') return null;
  const length = text[i + 1] === 'u' ? 4 : 8, digits = text.slice(i + 2, i + 2 + length);
  if (digits.length !== length || !/^[\da-fA-F]+$/.test(digits)) return null;
  const code = parseInt(digits, 16);
  return code > 0xFFFF ? null : { ch: String.fromCharCode(code), end: i + 2 + length };
}
/** True when an identifier (optionally @-prefixed or starting with a Unicode escape) starts at `i`. */
export function startsIdentifier(text, i) {
  let c = text.charCodeAt(i); if (c === 64) c = text.charCodeAt(++i);
  if (c < 128) { if (c >= 97 && c <= 122 || c >= 65 && c <= 90 || c === 95) return true; if (c !== 92) return false; }
  return isIdentifierStart(text[i]) || isIdentifierStart(escapeAt(text, i)?.ch);
}
/**
 * Scans an identifier. Returns { end, value, verbatim, hasEscapes } where `value` is the value text:
 * escapes decoded, formatting characters removed and the @ prefix dropped. Returns null when no identifier starts here.
 */
export function scanIdentifier(text, start) {
  let i = start, value = '', hasEscapes = false; const verbatim = text[i] === '@'; if (verbatim) i++;
  // Fast path: ASCII letters, digits and underscores with no escape or non-ASCII character following.
  let c = text.charCodeAt(i);
  if (c >= 97 && c <= 122 || c >= 65 && c <= 90 || c === 95) {
    let j = i; do c = text.charCodeAt(++j); while (c >= 97 && c <= 122 || c >= 65 && c <= 90 || c === 95 || c >= 48 && c <= 57);
    if (!(c >= 128 || c === 92)) return { end: j, value: text.slice(i, j), verbatim, hasEscapes: false };
  }
  for (let first = true; ; first = false) {
    const escape = escapeAt(text, i), ch = escape ? escape.ch : text[i];
    if (!(first ? isIdentifierStart(ch) : isIdentifierPart(ch))) break;
    if (!formatting.test(ch)) value += ch;
    if (escape) { hasEscapes = true; i = escape.end; } else i++;
  }
  return value ? { end: i, value, verbatim, hasEscapes } : null;
}
/** Identifier equality after Unicode normalization form C, as the language specification requires. */
export function identifierEquals(a, b) { return a === b || a.normalize('NFC') === b.normalize('NFC'); }
