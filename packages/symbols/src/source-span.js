export function lineIndex(source) {
  const lines = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) lines.push(i + 1);
  return lines;
}
export function sourceSpan(source, start = 0, end = start + 1, lines = lineIndex(source)) {
  start = Math.min(Math.max(0, start), source.length);
  end = Math.min(Math.max(start + 1, end), source.length);
  const at = (n) => {
      let l = 0,
        r = lines.length;
      while (l < r) {
        const m = (l + r) >>> 1;
        if (lines[m] <= n) l = m + 1;
        else r = m;
      }
      const index = Math.max(0, l - 1);
      return { line: index + 1, column: n - lines[index] + 1 };
    },
    a = at(start),
    z = at(end);
  if (z.line === a.line && z.column <= a.column) z.column = a.column + 1;
  return { ...a, endLine: z.line, endColumn: z.column };
}
