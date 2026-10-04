import {qualifiedName, symbolNameToken} from './source-symbols.js';

/** A structured metadata navigation target for an actual bound external member, never a parsed hover label. */
export function metadataReference(node, uri, source) {
  const symbol = node.method ?? node.field ?? node.property ?? node.event;
  if (!symbol?.containingType || symbol.syntax || !source) return null;
  const token = symbolNameToken(node.syntax);
  if (!token || token.isMissing) return null;
  const assembly = symbol.containingType.containingAssembly;
  const metadata = {owner: qualifiedName(symbol.containingType), name: symbol.name, kind: symbol.kind.toLowerCase(),
    type: (symbol.type ?? symbol.returnType)?.toDisplayString(),
    parameters: (symbol.parameters ?? []).map(parameter => ({name: parameter.name, type: parameter.type?.toDisplayString()}))};
  const identity = assembly?.identity?.name ?? assembly?.name;
  if (typeof identity === 'string') metadata.assemblyIdentity = identity;
  return {uri, ...token.span, metadata, contents: symbol.toDisplayString()};
}
