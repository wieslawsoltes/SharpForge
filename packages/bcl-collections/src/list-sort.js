import {sortItems} from './comparers/ordering.js';
import {count, data, change, writeArray} from './legacy-storage.js';

/** Sort a rooted live-prefix copy before writing; comparer faults leave storage and version unchanged. */
export function sortList(platform, reference, comparer = null) {
  const items = data(platform, reference).slice(0, count(platform, reference));
  return platform.heap.withRoots(items, () => {
    sortItems(platform, items, comparer);
    const storage = platform.get(reference, '$data');
    // An observer may collect after overwriting a value still needed later in this permutation.
    // Keep every pending value rooted once for the operation, including during write notifications.
    for (let index = 0; index < items.length; index++) writeArray(platform, storage, index, items[index]);
    platform.set(reference, '$count', items.length);
    change(platform, reference);
    return null;
  });
}
