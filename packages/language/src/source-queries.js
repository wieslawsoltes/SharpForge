import {findTextMatches} from '@sharpforge/text';
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

/** Group bound source calls while keeping stale hierarchy requests explicit. */
export function sourceCalls(service, item, direction = 'incoming') {
  if (item.revision !== service.workspace.revision) throw new Error('Call hierarchy is stale; prepare it again');
  const result = service.workspace.compile();
  const symbol = result.symbols.find(value => value.id === item.id && value.kind === 'method');
  if (!symbol) return [];
  const groups = new Map();
  for (const reference of result.references) {
    if (!reference.call) continue;
    const matches = direction === 'incoming' ? reference.symbolId === symbol.id : reference.callerId === symbol.id;
    if (!matches) continue;
    const id = direction === 'incoming' ? reference.callerId : reference.symbolId;
    const target = result.symbols.find(value => value.id === id && value.kind === 'method');
    if (!target) continue;
    if (!groups.has(id)) groups.set(id, {item: service.callItem(target), ranges: []});
    groups.get(id).ranges.push({uri: reference.uri, start: reference.start, end: reference.end});
  }
  return [...groups.values()];
}

/** Search all admitted immutable source documents using the public text matcher. */
export function findSourceText(workspace, query, options) {
  return findTextMatches([...workspace.documents.values()].map(document => document.source), query, options);
}

/** Format the existing source-symbol detail without broadening the supported language profile. */
export function sourceSymbolDetail(symbol) {
  if (symbol.kind === 'method') {
    const owner = symbol.owner ? symbol.owner + '.' : '';
    const parameters = (symbol.parameters ?? []).map(parameter => parameter.type + ' ' + parameter.name).join(', ');
    return `${symbol.isStatic ? 'static ' : ''}${symbol.type} ${owner}${symbol.name}(${parameters})`;
  }
  return symbol.kind === 'class' ? `class ${symbol.name}` : `${symbol.type} ${symbol.name}`;
}
