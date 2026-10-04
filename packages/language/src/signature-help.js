/** Resolve the active invocation through the existing compilation's method symbols. */
export function boundSignatureHelp(workspace, uri, offset, symbolDetail) {
  const text = workspace.documents.get(uri)?.source.text.slice(0, offset) ?? '';
  const match = text.match(/([\p{L}\p{N}_.]+)\s*\(([^()]*)$/u);
  if (!match) return null;
  const name = match[1];
  const index = match[2].split(',').length - 1;
  const methods = workspace.compile().symbols.filter(symbol => symbol.kind === 'method' &&
    (symbol.name === name || symbol.owner + '.' + symbol.name === name));
  return {activeParameter: index, signatures: methods.map(symbol => ({label: symbolDetail(symbol),
    parameters: (symbol.parameters ?? []).map(parameter => ({label: parameter.type + ' ' + parameter.name}))}))};
}
