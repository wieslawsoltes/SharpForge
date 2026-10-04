import { forEachChild } from './bound/semantic-walker.js';
import { SymbolKind } from './symbols/types.js';

const typeOf = value => value?.type ?? value;
const spanOf = node => node?.span ?? node;

function nodeSymbol(node) {
  return node.method ?? node.field ?? node.property ?? node.event ?? node.local ?? node.parameter
    ?? node.referencedType ?? node.symbol ?? null;
}

function selection(node) {
  const syntax = node.syntax;
  const expression = syntax?.expression ?? syntax;
  return expression?.name?.identifier ?? expression?.identifier ?? syntax;
}

/** Index actual bound metadata/source symbols by UTF-16 spans; no identifiers are guessed from text. */
export function indexMetadataLanguageBindings(analysis, result, { signal, maxNodes = 100000 } = {}) {
  const entries = [];
  const visited = new Set();
  for (const [owner, body] of result.bound) {
    const uri = body.binder?.c.uri ?? owner.uri ?? owner.locations?.[0]?.uri ?? owner.source?.uri;
    const pending = [body];
    while (pending.length) {
      signal?.throwIfAborted();
      const node = pending.pop();
      if (visited.has(node)) continue;
      if (visited.size >= maxNodes) throw new RangeError('Metadata language binding node limit exceeded');
      visited.add(node);
      const symbol = nodeSymbol(node);
      const span = spanOf(selection(node));
      if (uri && symbol && Number.isInteger(span?.start) && Number.isInteger(span?.end)) {
        const valueType = symbol.kind === SymbolKind.NamedType ? symbol : typeOf(node.type ?? symbol.type);
        entries.push({ uri, start: span.start, end: span.end, symbol, valueType });
      }
      forEachChild(node, child => pending.push(child));
    }
  }
  for (const use of analysis.symbolUses ?? []) {
    const span = spanOf(use.node?.identifier ?? use.node);
    if (Number.isInteger(span?.start) && Number.isInteger(span?.end)) {
      entries.push({ uri: use.uri, start: span.start, end: span.end, symbol: use.symbol, valueType: typeOf(use.symbol.type) });
    }
  }
  return entries.sort((left, right) => left.start - right.start || left.end - right.end);
}

/** Stable data-only symbol shape; metadata definitions have no editable source location. */
export function metadataLanguageSymbol(symbol, location = {}) {
  const type = typeOf(symbol.returnType ?? symbol.type);
  const owner = symbol.containingType?.toDisplayString() ?? null;
  return {
    name: symbol.name,
    kind: symbol.kind === SymbolKind.NamedType ? 'class' : symbol.kind.toLowerCase(),
    type: type?.toDisplayString?.() ?? symbol.toDisplayString(),
    owner,
    fullName: symbol.toDisplayString(),
    assembly: symbol.containingAssembly?.name ?? symbol.containingType?.containingAssembly?.name ?? null,
    isStatic: symbol.isStatic === true,
    metadata: !symbol.isSource && Boolean(symbol.containingAssembly ?? symbol.containingType?.containingAssembly),
    parameters: (symbol.parameters ?? []).map(parameter => ({ name: parameter.name, type: typeOf(parameter.type)?.toDisplayString() })),
    ...location
  };
}
