import {equal} from './object-equality.js';
import {count, data} from './legacy-storage.js';
import {removeListSpan} from './list-removal.js';

/** Search for the first equal value, then shift its suffix through the existing removal seam. */
export function removeListValue(p, reference, value) {
  const items = data(p, reference);
  const size = count(p, reference);
  for (let index = 0; index < size; index++) {
    if (!equal(p, items[index], value)) continue;
    removeListSpan(p, reference, index, 1);
    return p.managed(true, 'bool');
  }
  return p.managed(false, 'bool');
}

/** Clear only live references; empty Clear keeps its released no-op version behavior. */
export function clearList(p, reference) {
  const size = count(p, reference);
  return size ? removeListSpan(p, reference, 0, size) : null;
}
