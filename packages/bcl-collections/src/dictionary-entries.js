import {data, positions} from './legacy-storage.js';

/** Visit managed Dictionary key/value pairs in storage enumeration order. */
export function* dictionaryEntries(platform, reference) {
  const items = data(platform, reference);
  for (const index of positions(platform, reference)) {
    yield [items[index * 2], items[index * 2 + 1]];
  }
}
