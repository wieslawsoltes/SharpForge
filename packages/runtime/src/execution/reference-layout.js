/** Validate GC slots in explicit layouts in O(n log n), never comparing every field pair. */
export function validateReferenceLayout(references, scalars, pointerSize, invalid) {
  const ordered = [...new Set(references)].sort((left, right) => left - right);
  const ranges = [...scalars].sort((left, right) => left[0] - right[0]);
  for (let index = 0; index < ordered.length; index++) {
    const offset = ordered[index];
    if (offset % pointerSize || index && offset < ordered[index - 1] + pointerSize) {
      invalid('Explicit managed references must occupy aligned, complete pointer slots');
    }
  }
  let reference = 0;
  for (const [start, end] of ranges) {
    while (reference < ordered.length && ordered[reference] + pointerSize <= start) reference++;
    if (reference < ordered.length && ordered[reference] < end) {
      invalid('Explicit scalar storage cannot overlap a managed reference');
    }
  }
  return ordered;
}
