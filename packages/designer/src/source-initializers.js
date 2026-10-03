import {toLegacyExpression} from '@sharpforge/syntax';

/** Projects nested collection initializers from the lossless parser into designer-owned expression records. */
export function mapDesignInitializers(parsed) {
  if (!parsed.features.some(feature => feature.id === 'CollectionInitializer')) return [];
  const constructions = new Map();
  const pending = [parsed.root];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.kind === 'New') constructions.set(node.start, node);
    for (const [key, value] of Object.entries(node)) {
      if (['source', 'tokens', 'nameSpan', 'symbol'].includes(key)) continue;
      if (Array.isArray(value)) pending.push(...value);
      else if (value && typeof value === 'object') pending.push(value);
    }
  }
  const supportedSpans = [];
  const redNodes = [parsed.syntax];
  while (redNodes.length) {
    const red = redNodes.pop();
    const creation = constructions.get(red.span.start);
    if (creation && ['ObjectCreationExpression', 'ImplicitObjectCreationExpression'].includes(red.kind)) {
      for (const initializer of red.initializer?.expressions ?? []) {
        if (initializer.kind !== 'SimpleAssignmentExpression' || initializer.left.kind !== 'IdentifierName'
          || !['CollectionInitializerExpression', 'ObjectInitializerExpression'].includes(initializer.right.kind)) continue;
        const entry = creation.initializers.find(item => item.name === initializer.left.identifier.valueText);
        if (!entry) continue;
        const diagnostics = [];
        const items = [...initializer.right.expressions].map(item => toLegacyExpression(item, parsed.source,
          (start, end, code, message) => diagnostics.push({start, end, code, message})));
        if (diagnostics.length) continue;
        entry.expression = {kind: 'DesignCollection', uri: parsed.source.uri, start: initializer.right.span.start,
          end: initializer.right.span.end, items};
        supportedSpans.push({start: initializer.right.span.start, end: initializer.right.span.end});
      }
    }
    for (const child of red.childNodesAndTokens()) if (child.isNode) redNodes.push(child);
  }
  return supportedSpans;
}
