import {count, data} from './legacy-storage.js';

/** Visit managed Dictionary key/value pairs in storage enumeration order. */
export function* dictionaryEntries(platform, reference) {
  const items = data(platform, reference);
  for (let index = 0; index < count(platform, reference); index++) {
    yield [items[index * 2], items[index * 2 + 1]];
  }
}
