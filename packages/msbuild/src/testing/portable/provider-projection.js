function contains(span, reference) {
  return span.start <= reference.start && span.end >= reference.end;
}

/** Remove only pure constant iterator data classes with no executable references after attribute projection. */
export function discoveryOnlyProviderSpans(symbols, source, preserveTypes = []) {
  const preserved = new Set(preserveTypes);
  const attributes = symbols.attributeSpans.filter(span => span.uri === source.uri);
  return symbols.types.filter(type => {
    if (type.source.path !== source.uri || preserved.has(type.fqn) || type.hasFields || type.constructors.length ||
      !type.baseTypes.some(base => /(?:^|\.)IEnumerable(?:<|$)/.test(base)) ||
      !type.methods.length || !type.methods.every(method => method.name === 'GetEnumerator') ||
      !type.methods.some(method => method.constantRows)) return false;
    const references = symbols.identifierReferences?.get(type.name);
    // Frontends without reference spans cannot establish safe removal.
    if (!references) return false;
    return references.every(reference => reference.uri === source.uri &&
      (contains(type.declarationSpan, reference) || attributes.some(attribute => contains(attribute, reference))) ||
      symbols.attributeSpans.some(attribute => attribute.uri === reference.uri && contains(attribute, reference)));
  }).map(type => type.declarationSpan);
}
