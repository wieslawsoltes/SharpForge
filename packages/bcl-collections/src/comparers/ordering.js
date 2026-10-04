import {bclScalar, fail, resolveStringComparer, defaultStringOrdering} from '@sharpforge/bcl-core';

function compareDefault(platform, left, right) {
  const first = bclScalar(platform, left);
  const second = bclScalar(platform, right);
  if (first === second) return 0;
  if (first === null) return -1;
  if (second === null) return 1;
  if (typeof first === 'number' && typeof second === 'number') {
    return Number.isNaN(first) ? -1 : Number.isNaN(second) ? 1 : first - second;
  }
  if (typeof first === 'string' && typeof second === 'string') return defaultStringOrdering(platform).compare(first, second);
  if (typeof first === 'boolean' && typeof second === 'boolean') return first < second ? -1 : 1;
  fail(platform, 'InvalidOperationException', 'Default comparer is unavailable for this object type');
}

/** Sort the caller's rooted storage copy; null uses the shared default string-ordering profile. */
export function sortItems(platform, items, comparer = null) {
  if (comparer === null) return items.sort((first, second) => compareDefault(platform, first, second));
  const compare = resolveStringComparer(platform, comparer);
  return items.sort((first, second) => compare(bclScalar(platform, first), bclScalar(platform, second)));
}
