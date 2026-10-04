/** Collection contribution for immutable inline values; ordinary scalars and references require no traversal. */
export function visitInlineValueReferences(heap, value, visit) {
  if (!value?.managedReferences || value.valueType?.registry !== heap.methodTables || !Object.isFrozen(value)) return;
  for (const reference of value.managedReferences) visit(reference);
}
