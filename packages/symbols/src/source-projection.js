import { fail } from './contracts.js';
import { lineIndex } from './source-span.js';

function indexLocals(symbols) {
  const byMethod = new Map(symbols.methods.map((method) => [method.token, []]));
  for (const scope of symbols.scopes) {
    const locals = byMethod.get(scope.methodToken);
    if (!locals) continue;
    for (const variable of scope.variables) {
      locals.push({
        name: variable.name,
        slot: variable.index,
        hidden: variable.hidden,
        startOffset: scope.start,
        endOffset: scope.end,
      });
    }
  }
  return byMethod;
}

/** Project validated documents into debugger sources and UTF-16 spans. */
export function projectSources(symbols, documents, { includeUnverifiedPoints = false } = {}) {
  const locals = indexLocals(symbols);
  const indexes = documents.map((d) => (d.verified ? lineIndex(d.text) : [])),
    sequencePoints = [];
  for (const m of symbols.methods)
    for (const p of m.points) {
      const d = documents[p.document - 1];
      if (p.hidden || (!includeUnverifiedPoints && !d.verified)) continue;
      const lines = indexes[p.document - 1],
        valid = d.verified && p.startLine >= 1 && p.endLine <= lines.length && p.startColumn >= 1 && p.endColumn >= 1,
        start = valid ? lines[p.startLine - 1] + p.startColumn - 1 : 0,
        end = valid ? lines[p.endLine - 1] + p.endColumn - 1 : 1;
      if (d.verified && (!valid || start > d.text.length || end > d.text.length || end <= start))
        fail('Sequence point is outside verified source text');
      sequencePoints.push({
        id: sequencePoints.length,
        uri: d.name,
        line: p.startLine,
        column: p.startColumn,
        endLine: p.endLine,
        endColumn: p.endColumn,
        start,
        end,
        ilOffset: p.offset,
        methodToken: m.token,
        methodId: m.token & 0xffffff,
        sourceVerified: d.verified,
      });
    }
  return {
    documents,
    sequencePoints,
    sources: documents.filter((d) => d.verified).map((d) => ({ uri: d.name, text: d.text, version: 1 })),
    methods: symbols.methods.map((m) => ({
      token: m.token,
      locals: locals.get(m.token),
    })),
  };
}
