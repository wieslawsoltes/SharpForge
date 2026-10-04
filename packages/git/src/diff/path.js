const escaped = new Map([[7, '\\a'], [8, '\\b'], [9, '\\t'], [10, '\\n'], [11, '\\v'], [12, '\\f'], [13, '\\r'], [34, '\\"'], [92, '\\\\']]);

/** Valid UTF-8 names sort by scalar value, independent of the host locale. */
export function compareGitPaths(left, right) {
  let before = 0;
  let after = 0;
  while (before < left.length && after < right.length) {
    const first = left.codePointAt(before);
    const second = right.codePointAt(after);
    if (first !== second) return first - second;
    before += first > 0xffff ? 2 : 1;
    after += second > 0xffff ? 2 : 1;
  }
  return left.length - right.length;
}

/** Git's C-style path quoting, including octal bytes when quotePath is enabled. */
export function quoteGitPath(path, { quotePath = false } = {}) {
  const bytes = new TextEncoder().encode(path);
  if (![...bytes].some(byte => escaped.has(byte) || byte < 32 || byte === 127 || quotePath && byte > 127)) return path;
  let result = '"';
  if (!quotePath) {
    for (const character of path) {
      const code = character.codePointAt(0);
      result += escaped.get(code) ?? (code < 32 || code === 127 ? `\\${code.toString(8).padStart(3, '0')}` : character);
    }
  } else {
    for (const byte of bytes) result += escaped.get(byte) ?? (byte < 32 || byte >= 127
      ? `\\${byte.toString(8).padStart(3, '0')}` : String.fromCharCode(byte));
  }
  return `${result}"`;
}
