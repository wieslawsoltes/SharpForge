import {scanInterpolated} from './interpolation.js';
import { diagnostic, BoundedCache } from '@sharpforge/text';
export const keywords = new Set(('using namespace class public private internal protected static readonly const sealed partial void int double float bool string object char long decimal uint ulong short byte var new null true false if else while do for foreach in break continue return throw try catch finally this base get set enum struct interface async await virtual override abstract is as typeof default switch case out ref params lock unchecked checked').split(' '));
const operators = ['..', '>>=', '<<=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '??', '?.', '<<', '>>', '&=', '|=', '^=', '::'];
const identifierStart = /[\p{L}_]/u, identifierPart = /[\p{L}\p{N}\p{Mn}\p{Mc}\p{Pc}]/u;
const escapes = { e: '\x1b', n: '\n', r: '\r', t: '\t', '0': '\0', b: '\b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"' };
export function lex(source, cache = new BoundedCache()) {
  const text = source.text, tokens = [], diagnostics = []; let i = 0, reused = 0;
  const error = (start, length, code, message) => diagnostics.push(diagnostic(source, start, length, code, message));
  while (true) {
    const fullStart = i;
    for (;;) {
      if (/\s/.test(text[i] ?? '') && i < text.length) { i++; continue; }
      if (text.startsWith('//', i)) { while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++; continue; }
      if (text.startsWith('/*', i)) {
        const start = i; i += 2; while (i < text.length && !text.startsWith('*/', i)) i++;
        if (i === text.length) error(start, i - start, 'CS1035', 'End-of-file found, */ expected'); else i += 2;
        continue;
      }
      break;
    }
    const start = i, leading = text.slice(fullStart, start); let kind, value;
    if (i >= text.length) kind = 'eof';
    else if (text[i] === '#' ) {
      while (i < text.length && text[i] !== '\n') i++;
      kind = 'bad'; error(start, i - start, 'SF1001', 'Preprocessor directives are not supported by this compiler profile');
    } else if (text.startsWith('$"',i)||text.startsWith('$@"',i)||text.startsWith('@$"',i)) {
      const interpolation=scanInterpolated(text,i,error);i=interpolation.end;kind='interpolated';value=interpolation.parts;
    } else if (text[i] === '"' || text[i] === "'" || (text[i] === '@' && text[i + 1] === '"')) {
      const verbatim = text[i] === '@'; if (verbatim) i++;
      const quote = text[i++]; value = ''; let closed = false;
      while (i < text.length) {
        const ch = text[i++];
        if (ch === quote) { if (verbatim && text[i] === '"') { value += '"'; i++; continue; } closed = true; break; }
        if (!verbatim && (ch === '\n' || ch === '\r')) { i--; break; }
        if (!verbatim && ch === '\\') {
          const e = text[i++];
          if (e === 'u') { const hex = text.slice(i, i + 4); if (/^[\da-fA-F]{4}$/.test(hex)) { value += String.fromCharCode(parseInt(hex, 16)); i += 4; } else error(i - 2, 2, 'CS1009', 'Invalid Unicode escape'); }
          else if (e in escapes) value += escapes[e];
          else { error(i - 2, 2, 'CS1009', 'Unrecognized escape sequence'); value += e ?? ''; }
        } else value += ch;
      }
      if (!closed) error(start, i - start, 'CS1010', 'Newline or end of file in constant');
      kind = quote === "'" ? 'char' : 'string';
      if (kind === 'char' && value.length !== 1) error(start, i - start, 'CS1012', 'Character literal must contain one UTF-16 character');
    } else if (/[0-9]/.test(text[i])) {
      const numericStart = i;
      if (text[i] === '0' && /[xXbB]/.test(text[i + 1] ?? '')) { i += 2; while (/[\da-fA-F_]/.test(text[i] ?? '')) i++; }
      else {
        while (/[\d_]/.test(text[i] ?? '')) i++;
        if (text[i] === '.' && /\d/.test(text[i + 1] ?? '')) { i++; while (/[\d_]/.test(text[i] ?? '')) i++; }
        if (/[eE]/.test(text[i] ?? '')) { i++; if (/[+-]/.test(text[i] ?? '')) i++; while (/[\d_]/.test(text[i] ?? '')) i++; }
      }
      const raw = text.slice(numericStart, i).replaceAll('_', ''); kind = /[.eE]/.test(raw) && !/^0[xX]/.test(raw) ? 'double' : 'integer';
      value = Number(raw);
      if (/[fF]/.test(text[i] ?? '')) { kind = 'double'; i++; error(start, i - start, 'SF1005', 'Single-precision float literals are not implemented'); }
      else if (/[dD]/.test(text[i] ?? '')) { kind = 'double'; i++; }
      else if (/[mMlLuU]/.test(text[i] ?? '')) { while (/[mMlLuU]/.test(text[i] ?? '')) i++; error(start, i - start, 'SF1003', 'decimal, long and unsigned literals are not implemented'); }
      if (!Number.isFinite(value)) error(start, i - start, 'CS1013', 'Invalid numeric literal');
      if (kind === 'integer' && value > 2147483648) error(start, i - start, 'SF1004', 'This profile supports signed 32-bit integer literals');
    } else if (identifierStart.test(text[i]) || (text[i] === '@' && identifierStart.test(text[i + 1] ?? ''))) {
      const escaped = text[i] === '@'; if (escaped) i++;
      const s = i++; while (i < text.length && identifierPart.test(text[i])) i++;
      value = text.slice(s, i); kind = !escaped && keywords.has(value) ? value : 'identifier';
    } else {
      const op = operators.find(o => text.startsWith(o, i));
      if (op) { kind = op; i += op.length; }
      else { kind = text[i++]; if (!'{}()[];:,.?+-*/%<>=!~&|^'.includes(kind)) { error(start, 1, 'CS1056', `Unexpected character '${kind}'`); kind = 'bad'; } }
    }
    i = Math.min(i, text.length);
    const raw = text.slice(start, i), fullText = leading + raw, key = kind + '\0' + fullText;
    if (cache.map.has(key)) reused++;
    const green = cache.getOrAdd(key, () => Object.freeze({ kind, text: raw, leading, width: fullText.length, fullText, value }));
    tokens.push(Object.freeze({ kind, value, text: raw, start, end: i, fullStart, green }));
    if (kind === 'eof') break;
  }
  return { source, tokens: Object.freeze(tokens), diagnostics, internedTokenHits: reused };
}
