/** Stable plain records from one bound revision; no source symbols cross a worker boundary. */
export function sourceReferences(workspace, uri, offset, includeDeclaration = true) {
  const model = workspace.sourceModel();
  const reference = model?.referenceAt(uri, offset);
  if (!reference) return [];
  return model.references.filter(item => item.symbolId === reference.symbolId && (includeDeclaration || !item.declaration))
    .map(item => {
      const source = model.sources.get(item.uri);
      const lineStart = source.lineStarts[item.line];
      const lineEnd = source.lineStarts[item.line + 1] ?? source.length;
      return {...item, preview: source.text.slice(lineStart, Math.min(lineEnd, lineStart + 300)).trimEnd(),
        definitionLocation: item.definition, definition: item.definitionName};
    });
}

export function sourceReferenceLenses(workspace, uri) {
  const model = workspace.sourceModel();
  if (!model) return [];
  const counts = new Map();
  for (const reference of model.references) if (!reference.declaration) {
    counts.set(reference.symbolId, (counts.get(reference.symbolId) ?? 0) + 1);
  }
  return model.documentSymbols(uri).filter(symbol => ['method', 'field', 'property', 'event'].includes(symbol.kind))
    .map(symbol => ({uri, version: symbol.version, start: symbol.start, end: symbol.end,
      symbolId: symbol.id, count: counts.get(symbol.id) ?? 0}));
}
