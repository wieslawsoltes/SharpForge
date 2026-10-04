const severities = Object.freeze({1: 'error', 2: 'warning', 3: 'suggestion', 4: 'hidden', info: 'suggestion', hint: 'hidden'});
const semanticKinds = new Set(['class', 'type', 'struct', 'interface', 'enum', 'namespace', 'method', 'property', 'field',
  'event', 'parameter', 'local', 'variable']);

/** Converts diagnostics into rendering data; a mismatched version produces no decorations. */
export function diagnosticDecorations(diagnostics, source, options = {}) {
  const result = [];
  for (const diagnostic of diagnostics ?? []) {
    if (diagnostic.uri && diagnostic.uri !== source.uri) continue;
    if (diagnostic.version !== undefined && diagnostic.version !== source.version) continue;
    const start = diagnostic.start ?? source.offsetAt(diagnostic.range.start);
    const end = diagnostic.end ?? (diagnostic.length !== undefined ? start + diagnostic.length : source.offsetAt(diagnostic.range.end));
    if (start < 0 || end < start || end > source.length) continue;
    const severity = severities[diagnostic.severity] ?? diagnostic.severity ?? 'error';
    const unnecessary = diagnostic.tags?.some(tag => tag === 1 || tag === 'unnecessary');
    const deprecated = diagnostic.tags?.some(tag => tag === 2 || tag === 'deprecated');
    const classes = [`sf-diagnostic-${severity}`];
    if (unnecessary) classes.push('sf-diagnostic-unnecessary');
    if (deprecated) classes.push('sf-diagnostic-deprecated');
    result.push({start, end, className: classes.join(' '), kind: 'diagnostic', severity,
      hover: `${diagnostic.code ?? ''}: ${diagnostic.message ?? ''}`, diagnostic,
      glyph: severity !== 'hidden', overview: severity !== 'hidden',
      inlineMessage: options.inlineMessages ? diagnostic.message : undefined,
      quickFix: diagnostic.quickFix ?? diagnostic.hasCodeActions ?? false});
  }
  return result;
}

/** Overlays nonoverlapping semantic spans on lexical runs in O((L+S) log(L+S)). */
export function mergeSemanticTokens(lexicalRuns, semanticTokens, source, version = source.version) {
  if (version !== source.version) return lexicalRuns;
  const semantic = semanticTokens.filter(token => token.start >= 0 && token.end > token.start && token.end <= source.length)
    .sort((left, right) => left.start - right.start || right.end - left.end);
  for (let index = 1; index < semantic.length; index++) {
    if (semantic[index].start < semantic[index - 1].end) throw new RangeError('Semantic tokens must not overlap');
  }
  const runs = [];
  let semanticIndex = 0;
  for (const run of lexicalRuns) {
    let cursor = run.start;
    while (semanticIndex < semantic.length && semantic[semanticIndex].end <= cursor) semanticIndex++;
    let index = semanticIndex;
    while (index < semantic.length && semantic[index].start < run.end) {
      const token = semantic[index];
      if (token.start > cursor) runs.push({...run, start: cursor, end: Math.min(run.end, token.start)});
      const start = Math.max(cursor, token.start);
      const end = Math.min(run.end, token.end);
      if (start < end) runs.push({...run, start, end, kind: token.kind, semantic: true, modifiers: token.modifiers ?? []});
      cursor = end;
      if (token.end >= run.end) break;
      index++;
    }
    if (cursor < run.end) runs.push({...run, start: cursor});
  }
  return runs;
}

export function semanticDecorations(tokens, source, version = source.version) {
  if (version !== source.version) return [];
  return tokens.filter(token => semanticKinds.has(token.kind) && token.start >= 0 && token.end <= source.length)
    .map(token => ({...token, kind: 'semantic', className: `sf-semantic-${token.kind}`}));
}
