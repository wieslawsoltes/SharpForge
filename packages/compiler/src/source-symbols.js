/** Original source identities shared by navigation, rename and reference queries. */
export const originalSymbol = symbol => symbol?.originalDefinition ?? symbol;

export function symbolNameToken(syntax) {
  if (!syntax) return null;
  if (syntax.isToken) return syntax.kind === 'IdentifierToken' ? syntax : null;
  if (syntax.kind === 'InvocationExpression') return symbolNameToken(syntax.expression);
  if (syntax.kind === 'ObjectCreationExpression') return symbolNameToken(syntax.type);
  if (syntax.kind === 'QualifiedName') return symbolNameToken(syntax.right);
  if (syntax.kind === 'AliasQualifiedName') return symbolNameToken(syntax.name);
  if (syntax.kind === 'SimpleMemberAccessExpression' || syntax.kind === 'MemberBindingExpression') {
    return symbolNameToken(syntax.name);
  }
  return syntax.identifier ?? null;
}

export function sourceLocation(symbol, fallbackUri) {
  const token = symbolNameToken(symbol.syntax);
  const location = symbol.locations?.[0];
  const uri = symbol.uri ?? location?.uri ?? fallbackUri;
  const span = token?.span ?? location;
  return uri && span && Number.isInteger(span.start) ? {uri, start: span.start, end: span.end} : null;
}

export function qualifiedName(symbol) {
  const parts = [];
  for (let current = symbol; current; current = current.containingSymbol) {
    if (['NamedType', 'Namespace'].includes(current.kind) && current.name) parts.unshift(current.name);
  }
  return parts.join('.');
}

export function sourceSymbolRecord(symbol, fallbackUri) {
  const location = sourceLocation(symbol, fallbackUri);
  if (!location || symbol.isImplicitlyDeclared || !symbol.name || symbol.name.startsWith('<')) return null;
  const type = symbol.type ?? symbol.returnType;
  const kind = symbol.kind === 'NamedType' ? symbol.typeKind : symbol.kind.toLowerCase();
  const owner = symbol.containingType;
  const namespace = qualifiedName(symbol.containingNamespace);
  const record = {
    id: `${location.uri}:${location.start}:${kind}`, ...location, kind,
    name: symbolNameToken(symbol.syntax)?.valueText ?? symbol.name,
    type: type?.toDisplayString() ?? (symbol.kind === 'NamedType' ? qualifiedName(symbol) : ''),
    namespace, owner: owner?.name, ownerFullName: owner ? qualifiedName(owner) : undefined,
    fullName: symbol.kind === 'NamedType' ? qualifiedName(symbol) : undefined,
    isStatic: Boolean(symbol.isStatic), accessibility: symbol.declaredAccessibility,
    bodyStart: symbol.syntax?.span?.start, bodyEnd: symbol.syntax?.span?.end,
  };
  if (symbol.kind === 'Method' || symbol.kind === 'Property') {
    record.parameters = (symbol.parameters ?? []).map(p => ({name: p.name, type: p.type?.toDisplayString(), refKind: p.refKind}));
  }
  if (symbol.kind === 'NamedType') {
    record.baseType = symbol.baseType ? qualifiedName(symbol.baseType) : null;
    record.baseTypes = [symbol.baseType, ...symbol.interfaces].filter(Boolean).map(qualifiedName);
    record.arity = symbol.arity;
  }
  return record;
}
