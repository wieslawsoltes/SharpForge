import { loadError, LoadErrorCode } from './load-errors.js';

const escapes = Object.freeze({ '\\': '\\', ',': ',', '=': '=', "'": "'", '"': '"', t: '\t', r: '\r', n: '\n' });
const whitespace = character => character === ' ' || character === '\t' || character === '\r' || character === '\n';

/** Bounded linear tokenizer for the AssemblyName display-name grammar. */
export function displayNameTokens(input) {
  let offset = 0;
  const invalid = () => loadError(LoadErrorCode.InvalidName, 'Invalid assembly display name', { requested: input });
  if (typeof input !== 'string' || !input.length || input.includes('\0')) throw invalid();
  if (input.length > 32768) throw loadError(LoadErrorCode.LimitExceeded, 'Assembly display name exceeds 32768 characters');
  return function next() {
    while (whitespace(input[offset])) offset++;
    if (offset === input.length) return { kind: 'end' };
    if (input[offset] === ',' || input[offset] === '=') return { kind: input[offset++] };
    const quote = input[offset] === '"' || input[offset] === "'" ? input[offset++] : null;
    let value = '';
    while (offset < input.length) {
      const character = input[offset++];
      if (quote && character === quote) return { kind: 'text', value };
      if (!quote && (character === ',' || character === '=')) {
        offset--;
        break;
      }
      if (!quote && (character === '"' || character === "'")) throw invalid();
      if (character === '\\') {
        const escaped = input[offset++];
        if (!Object.hasOwn(escapes, escaped)) throw invalid();
        value += escapes[escaped];
      } else value += character;
    }
    if (quote) throw invalid();
    return { kind: 'text', value: value.replace(/[ \t\r\n]+$/, '') };
  };
}

/** Escape a display-name component without losing quoted leading/trailing whitespace. */
export function quoteAssemblyComponent(value) {
  const escaped = value.replace(/[\\,='"\t\r\n]/g, character => {
    const control = { '\t': 't', '\r': 'r', '\n': 'n' }[character];
    return '\\' + (control ?? character);
  });
  return value.trim() !== value || /['"]/.test(value) ? `"${escaped}"` : escaped;
}
