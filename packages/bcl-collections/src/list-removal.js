import {integer} from '@sharpforge/bcl-core';
import {count, change, writeArray} from './legacy-storage.js';

/** Remove an already validated span without replacing storage; retain released version semantics. */
export function removeListSpan(p, reference, index, length) {
  const size = count(p, reference);
  const remaining = size - length;
  if (length) {
    const storage = p.get(reference, '$data');
    const items = p.heap.get(storage).data;
    for (let target = index; target < remaining; target++) {
      writeArray(p, storage, target, items[target + length]);
    }
    for (let target = remaining; target < size; target++) writeArray(p, storage, target, null);
  }
  p.set(reference, '$count', remaining);
  // Keep the released version rule, including valid zero-length RemoveRange calls.
  change(p, reference);
  return null;
}

/** Validate before mutation; shift only the surviving suffix and clear vacated managed references. */
export function listRemoval(p, descriptor, context) {
  const {reference, native, size} = context;
  if (descriptor.name === 'RemoveAt') {
    return removeListSpan(p, reference, integer(p, native[0], 0, size - 1), 1);
  }
  const index = integer(p, native[0], 0, size);
  const length = integer(p, native[1], 0, size - index);
  return removeListSpan(p, reference, index, length);
}
