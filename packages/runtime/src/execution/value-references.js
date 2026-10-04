// Tracing is independent of heap and value construction so aggregate roots do not
// introduce a heap/storage dependency cycle. Metadata and code owners are opaque.

/** Visit managed handles reachable through immutable inline values and locations. */
export function forEachValueReference(value, visit) {
  if (value === null || typeof value !== 'object') return;
  if (Number.isInteger(value.h) && Number.isInteger(value.g)) {
    visit(value);
    return;
  }
  if (!value.byref && !value.valueType && !value.nullableType && !value.span && !value.typedReference) return;
  const pending = [value];
  const seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    if (Number.isInteger(current.h) && Number.isInteger(current.g)) {
      visit(current);
      continue;
    }
    if (seen.has(current)) continue;
    seen.add(current);
    if (current.byref) {
      if (current.owner) pending.push(current.owner);
      if (current.source) pending.push(current.source);
    } else if (current.span || current.typedReference) pending.push(current.pointer);
    else if (current.nullableType && current.hasValue) pending.push(current.value);
    else if (current.valueType && Array.isArray(current.fields)) {
      // Recurse over actual immutable fields; host edits must not hide references
      // behind stale metadata. Scalar branches return without further allocation.
      for (let index = current.fields.length - 1; index >= 0; index--) {
        const field = current.fields[index];
        if (field !== null && typeof field === 'object') pending.push(field);
      }
    }
  }
}
