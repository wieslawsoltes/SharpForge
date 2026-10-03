import { scanConditionalDirective, scanDisabledText } from '../directives/conditional.js';
import { scanMiscDirective } from '../directives/misc.js';
import { scanScriptDirective } from '../directives/script.js';
/** Trivia scanning: whitespace, end-of-line, comments, documentation comments, directives and disabled text. */
const whitespace = /[\t\v\f\x1A\xA0\p{Zs}]/u, BOM = String.fromCharCode(0xFEFF);
export function isWhitespace(ch) { return ch !== undefined && (ch === BOM || whitespace.test(ch)); }
const NEL = String.fromCharCode(0x85), LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
/** Length of the line break at `i` (2 for CRLF, 1 for CR, LF, U+0085, U+2028, U+2029), or 0. */
export function endOfLineLength(text, i) {
  const ch = text[i];
  if (ch === '\r') return text[i + 1] === '\n' ? 2 : 1;
  return ch === '\n' || ch === NEL || ch === LS || ch === PS ? 1 : 0;
}
const lineEnd = (text, i) => { while (i < text.length && !endOfLineLength(text, i)) i++; return i; };
const structural = new Set(['if', 'elif', 'else', 'endif', 'region', 'endregion']);
/** Lexes the directive whose `#` is at `hash`. The trivia runs from `#` through the line break. Inactive directives keep their structure but have no effect. */
function directive(s, hash) {
  const text = s.text, stop = lineEnd(text, hash), end = stop + endOfLineLength(text, stop), body = text.slice(hash + 1, stop), features = [];
  const marker = body[0] === '!' || body[0] === ':' ? body[0] : null, name = marker ? null : /^[ \t]*([A-Za-z_]\w*)?/.exec(body);
  const word = name?.[1] ?? '', rest = marker ? body.slice(1) : body.slice(name[0].length), active = s.state.active;
  const context = { offset: hash, seenToken: s.state.seenToken, afterIf: s.state.sawIf, script: !!s.options.script, fileBasedProgram: s.options.fileBasedProgram };
  const result = (marker || word === 'r' || word === 'load' ? scanScriptDirective(marker, word, rest, context, features) : null)
    ?? scanConditionalDirective(word, rest, s.state) ?? scanMiscDirective(word, rest, features)
    ?? { kind: 'BadDirectiveTrivia', structure: { directive: word || null }, diagnostics: [['CS1024', 'Preprocessor directive expected']], unknown: true };
  if (word === 'if') s.state.sawIf = true;
  const structure = Object.freeze({ isActive: active, ...result.structure }), piece = Object.freeze({ kind: result.kind ?? 'BadDirectiveTrivia', start: hash, end, structure });
  if (active || structural.has(word) || result.unknown) for (const [code, message, severity] of result.diagnostics) s.error(hash, stop - hash, code, message, severity);
  if (active) for (const id of features) s.feature(id, hash, stop);
  s.directives.push(piece); s.i = end; return piece;
}
/**
 * Scans the trivia at `s.i`. In trailing mode (directly after a token) pieces up to and including the first
 * end-of-line belong to the previous token, as in Roslyn; a documentation comment or directive ends the trailing
 * trivia early. Returns { trailing, leading } lists of frozen { kind, start, end, structure? } pieces.
 */
export function scanTrivia(s, trailingMode) {
  const text = s.text, trailing = [], leading = []; let out = trailingMode ? trailing : leading, lineStart = !trailingMode && (s.i === 0 || !!endOfLineLength(text, s.i - 1));
  const push = (kind, start, end) => out.push(Object.freeze({ kind, start, end }));
  for (;;) {
    const i = s.i, ch = text[i]; if (i >= text.length) break;
    const eol = endOfLineLength(text, i);
    if (eol) { s.i += eol; push('EndOfLineTrivia', i, s.i); out = leading; lineStart = true; continue; }
    if (isWhitespace(ch)) { while (isWhitespace(text[s.i])) s.i++; push('WhitespaceTrivia', i, s.i); continue; }
    if (ch === '/' && text[i + 1] === '/') {
      if (text[i + 2] === '/' && text[i + 3] !== '/') {
        out = leading;
        for (;;) { s.i = lineEnd(text, s.i); s.i += endOfLineLength(text, s.i); let j = s.i; while (isWhitespace(text[j])) j++; if (text.startsWith('///', j) && text[j + 3] !== '/') s.i = j; else break; }
        push('SingleLineDocumentationCommentTrivia', i, s.i); lineStart = !!endOfLineLength(text, s.i - 1); continue;
      }
      s.i = lineEnd(text, i); push('SingleLineCommentTrivia', i, s.i); lineStart = false; continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2), doc = text[i + 2] === '*' && text[i + 3] !== '*' && text[i + 3] !== '/';
      if (close < 0) { s.i = text.length; s.error(i, s.i - i, 'CS1035', 'End-of-file found, */ expected'); } else s.i = close + 2;
      if (doc) out = leading;
      push(doc ? 'MultiLineDocumentationCommentTrivia' : 'MultiLineCommentTrivia', i, s.i); lineStart = false; continue;
    }
    if (ch === '#' && s.options.directives !== false) {
      if (!lineStart) {
        const stop = lineEnd(text, i); s.i = stop + endOfLineLength(text, stop);
        s.error(i, 1, 'CS1040', 'Preprocessor directives must appear as the first non-whitespace character on a line'); push('SkippedTokensTrivia', i, s.i); continue;
      }
      out = leading; leading.push(directive(s, i)); lineStart = true;
      if (!s.state.active) { const from = s.i; s.i = scanDisabledText(text, from); if (s.i > from) push('DisabledTextTrivia', from, s.i); }
      continue;
    }
    break;
  }
  return { trailing, leading };
}
