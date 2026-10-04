const references = new WeakMap();

/** Issue the existing immutable handle shape without making a retained handle retain its heap. */
export function createHeapReference(heap, h, g) {
  let issued = references.get(heap);
  if (!issued) references.set(heap, issued = new WeakSet());
  const reference = Object.freeze({h, g});
  issued.add(reference);
  return reference;
}

/** Allocation provenance only: callers must separately check generation and live record validity. */
export function ownsHeapReference(heap, reference) {
  return references.get(heap)?.has(reference) ?? false;
}
