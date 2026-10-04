import {count, change, writeArray} from './legacy-storage.js';

/** Reverse the live prefix in place, retaining a displaced reference across observer-triggered GC. */
export function reverseList(platform, reference) {
  const size = count(platform, reference);
  if (size > 1) {
    const storage = platform.get(reference, '$data');
    const items = platform.heap.get(storage).data;
    const rootIndex = platform.heap.pins.length;
    // Reuse one temporary root for the whole operation; withRoots also cleans up a throwing observer.
    platform.heap.withRoots([null], () => {
      for (let left = 0, right = size - 1; left < right; left++, right--) {
        const displaced = items[left];
        platform.heap.pins[rootIndex] = displaced;
        writeArray(platform, storage, left, items[right]);
        writeArray(platform, storage, right, displaced);
      }
    });
  }
  platform.set(reference, '$count', size);
  change(platform, reference);
  return null;
}
