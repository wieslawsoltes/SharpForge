/** A conservative lexical gate, not data-flow analysis. V8 separately parses and links every inspected module. */
export function codeTokens(source) {
  const tokens = [];
  let at = 0;
  const emit = (value, start) => tokens.push({ value, start, end: at });
  const readString = quote => {
    at++;
    while (at < source.length) {
      if (source[at] === '\\') { at += 2; continue; }
      if (source[at++] === quote) return;
    }
  };
  const identifier = () => {
    let value = '';
    while (at < source.length) {
      const escape = /^\\u(?:\{([0-9a-f]+)\}|([0-9a-f]{4}))/i.exec(source.slice(at));
      if (escape) { value += String.fromCodePoint(parseInt(escape[1] ?? escape[2], 16)); at += escape[0].length; }
      else if (/[\p{ID_Continue}$\u200c\u200d]/u.test(source[at])) value += source[at++];
      else break;
    }
    return value;
  };
  const scan = interpolation => {
    let braces = 0, regexAllowed = true;
    const parentheses = [];
    while (at < source.length) {
      const start = at, ch = source[at], last = tokens.at(-1)?.value;
      if (/\s/.test(ch)) { at++; continue; }
      if (source.startsWith('//', at)) { at = source.indexOf('\n', at + 2); if (at < 0) at = source.length; continue; }
      if (source.startsWith('/*', at)) { const end = source.indexOf('*/', at + 2); at = end < 0 ? source.length : end + 2; continue; }
      if (ch === '"' || ch === "'") { readString(ch); emit('<string>', start); regexAllowed = false; continue; }
      if (ch === '`') {
        at++; emit('<template>', start);
        while (at < source.length) {
          if (source[at] === '\\') { at += 2; continue; }
          if (source[at] === '`') { at++; break; }
          if (source.startsWith('${', at)) { at += 2; scan(true); } else at++;
        }
        regexAllowed = false; continue;
      }
      if (ch === '/' && regexAllowed) {
        at++; let characterClass = false;
        while (at < source.length) {
          const current = source[at++];
          if (current === '\\') at++;
          else if (current === '[') characterClass = true;
          else if (current === ']') characterClass = false;
          else if (current === '/' && !characterClass) break;
          else if (current === '\n' || current === '\r') break;
        }
        while (/[a-z]/i.test(source[at] ?? '') && at < source.length) at++;
        emit('<regexp>', start); regexAllowed = false; continue;
      }
      if (/[\p{ID_Start}$_]/u.test(ch) || source.startsWith('\\u', at)) {
        const value = identifier();
        if (!value) { at++; emit(ch, start); continue; }
        emit(value, start);
        regexAllowed = ['return', 'throw', 'yield', 'await', 'case', 'delete', 'void', 'typeof', 'in', 'of'].includes(value);
        continue;
      }
      if (/[0-9]/.test(ch)) {
        at++; while (/[\w.]/.test(source[at] ?? '') && at < source.length) at++;
        emit('<number>', start); regexAllowed = false; continue;
      }
      if (ch === '}' && interpolation && braces === 0) { at++; return; }
      if (ch === '{') braces++;
      if (ch === '}') braces--;
      if (ch === '(') parentheses.push(['if', 'while', 'for', 'with', 'switch', 'catch'].includes(last));
      at++;
      const pair = source.slice(start, at + 1);
      if (['?.', '++', '--', '=>'].includes(pair)) at++;
      const value = source.slice(start, at); emit(value, start);
      regexAllowed = ch === ')' ? !!parentheses.pop() : ![']', '.', '?.', '++', '--'].includes(value);
    }
  };
  scan(false); return tokens;
}

export function dynamicCodeUses(source) {
  const tokens = codeTokens(source), uses = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], previous = tokens[i - 1]?.value, next = tokens[i + 1]?.value;
    let operation;
    if (token.value === 'import' && next === '(' && !['.', '?.'].includes(previous)) operation = 'dynamic-import';
    const globalProperty = ['globalThis', 'window', 'self', 'global'].includes(tokens[i - 2]?.value);
    if (token.value === 'eval' && next !== ':' && (!['.', '?.'].includes(previous) || globalProperty)) operation = 'eval';
    if (token.value === 'Function' && previous === 'new') operation = 'new-Function';
    if (operation) uses.push({ operation, start: token.start, line: source.slice(0, token.start).split('\n').length });
  }
  return uses;
}
