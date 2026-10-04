import {forEachValueReference} from './value-references.js';

/** Canonical fields remain authoritative even if a copied value has an old reference inventory. */
export function visitInlineValueReferences(heap, value, visit) {
  if (!Array.isArray(value?.fields) || value.valueType?.registry !== heap.methodTables || !Object.isFrozen(value)) return;
  forEachValueReference(value, visit);
}
