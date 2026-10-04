/** Chunked lexical/indentation fallback. A generation predicate cancels stale documents between batches. */
export async function scanFoldingRanges(source, tokens, isCurrent) {
  const ranges = [];
  const regions = [];
  const indentation = [];
  let usingStart = -1;
  for (let line = 0; line < source.lineCount; line++) {
    if (line % 128 === 0) {
      if (!isCurrent()) return null;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const start = source.lineStart(line);
    const end = source.lineEnd(line);
    const text = source.getText(start, Math.min(end, start + 4096));
    const trimmed = text.trim();
    if (/^#region\b/.test(trimmed)) regions.push(line);
    else if (/^#endregion\b/.test(trimmed) && regions.length) ranges.push({startLine: regions.pop(), endLine: line, kind: 'region'});
    if (/^(?:global\s+)?using\s+(?:static\s+)?[\w.]+(?:\s*=.*)?;/.test(trimmed)) {
      if (usingStart < 0) usingStart = line;
    } else if (usingStart >= 0) {
      if (line > usingStart + 1) ranges.push({startLine: usingStart, endLine: line - 1, kind: 'imports'});
      usingStart = -1;
    }
    if (!trimmed) continue;
    const indent = text.length - text.trimStart().length;
    while (indentation.length && indentation.at(-1).indent >= indent) {
      const previous = indentation.pop();
      if (line > previous.line + 1) ranges.push({startLine: previous.line, endLine: line - 1, kind: 'indent'});
    }
    indentation.push({line, indent});
  }
  if (usingStart >= 0 && source.lineCount > usingStart + 1) {
    ranges.push({startLine: usingStart, endLine: source.lineCount - 1, kind: 'imports'});
  }
  const braces = [];
  for (let index = 0; tokens && index < tokens.length; index++) {
    if (index % 1024 === 0) {
      if (!isCurrent()) return null;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const token = tokens.get(index);
    if (token.kind === '{') braces.push(source.positionAt(token.start).line);
    if (token.kind === '}' && braces.length) {
      const startLine = braces.pop();
      const endLine = source.positionAt(token.start).line;
      if (endLine > startLine) ranges.push({startLine, endLine, kind: 'code'});
    }
    for (const piece of [...(token.leadingTrivia ?? []), ...(token.trailingTrivia ?? [])]) {
      if (!/comment/i.test(piece.kind)) continue;
      const startLine = source.positionAt(piece.start).line;
      const endLine = source.positionAt(Math.max(piece.start, piece.end - 1)).line;
      if (endLine > startLine) ranges.push({startLine, endLine, kind: 'comment'});
    }
  }
  return isCurrent() ? ranges : null;
}
