import {data, positions} from './legacy-storage.js';

/** Visit managed HashSet values in physical slot order, including a live null value. */
export function* hashSetValues(platform, reference) {
  const items = data(platform, reference);
  for (const index of positions(platform, reference)) yield items[index];
}
