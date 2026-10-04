/** Bound types for implicit local declarations; ranges are UTF-16 offsets in the requested document. */
export function boundInlayHints(workspace, uri, range = {}) {
  const source = (workspace.documents.get(uri) ?? workspace.generatedDocuments.get(uri))?.source;
  if (!source) throw new Error('Document is not open');
  const start = range.start ?? 0;
  const end = range.end ?? source.length;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > source.length) {
    throw new RangeError('Invalid inlay hint range');
  }
  const tokens = workspace.syntax(uri).tokens;
  const implicitStarts = new Set();
  for (let index = 0; index + 1 < tokens.length; index++) {
    if (tokens[index].kind === 'var') implicitStarts.add(tokens[index + 1].start);
  }
  const model = workspace.sourceModel();
  const typeHints = (model?.symbols ?? []).filter(symbol => symbol.uri === uri && symbol.kind === 'local' && symbol.type !== 'error' &&
    symbol.start >= start && symbol.end <= end && implicitStarts.has(symbol.start)).map(symbol => ({
    position: source.positionAt(symbol.end), label: ': ' + symbol.type, kind: 1, paddingLeft: false, paddingRight: true
  }));
  const parameterHints = (model?.hints ?? []).filter(hint => hint.uri === uri && hint.offset >= start && hint.offset <= end);
  return [...typeHints, ...parameterHints].sort((a, b) => source.offsetAt(a.position) - source.offsetAt(b.position));
}
