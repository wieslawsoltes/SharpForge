import {ManagedFault} from './heap.js';
import {JSON_TEXT_LIMIT} from './json-limits.js';

const unicodeEscape = code => '\\u' + code.toString(16).toUpperCase().padStart(4, '0');
const htmlEscapes = Object.freeze({
  '<': '\\u003C', '>': '\\u003E', '&': '\\u0026', "'": '\\u0027', '+': '\\u002B', '`': '\\u0060'
});

function textLimit() {
  throw new ManagedFault('JsonException', 'Serialized JSON text limit exceeded');
}

/** Apply default .NET string encoding to canonical JSON.stringify output, preserving every non-string token. */
export function escapeJsonStrings(text) {
  if (typeof text !== 'string' || text.length > JSON_TEXT_LIMIT) textLimit();
  const parts = [];
  let quoted = false;
  let start = 0;
  let length = text.length;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted) continue;
    let replacement = htmlEscapes[character];
    let consumed = 1;
    if (character === '\\') {
      const escaped = text[index + 1];
      if (escaped === 'u') {
        const code = Number.parseInt(text.slice(index + 2, index + 6), 16);
        // JSON.stringify writes an isolated surrogate as a \u escape; the default encoder replaces it.
        replacement = unicodeEscape(code >= 0xd800 && code <= 0xdfff ? 0xfffd : code);
        consumed = 6;
      } else {
        if (escaped === '"') replacement = '\\u0022';
        consumed = 2;
      }
    } else if (text.charCodeAt(index) >= 0x7f) {
      replacement = unicodeEscape(text.charCodeAt(index));
    }
    if (replacement !== undefined) {
      length += replacement.length - consumed;
      if (length > JSON_TEXT_LIMIT) textLimit();
      if (index > start) parts.push(text.slice(start, index));
      parts.push(replacement);
      start = index + consumed;
    }
    index += consumed - 1;
  }
  if (!parts.length) return text;
  parts.push(text.slice(start));
  return parts.join('');
}
