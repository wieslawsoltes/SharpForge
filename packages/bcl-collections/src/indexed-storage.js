import {makeArray} from '@sharpforge/bcl-core';
import {
  ACTIVE_SLOT, count, data, change, reserve, write, writeArray, indexMap, keyOf, rememberIndex
} from './legacy-storage.js';

/** Payload widths stay unchanged; managed Int32 slots hold live markers or the next free position. */
export function reserveIndexed(p, reference, needed, width) {
  reserve(p, reference, needed, width);
  const capacity = data(p, reference).length / width;
  const previous = p.get(reference, '$slots');
  const states = previous ? p.heap.get(previous).data : [];
  if (states.length >= capacity) return;
  const next = states.concat(Array(capacity - states.length).fill(-1));
  // Accept a restored dense snapshot as well as newly constructed indexed collections.
  if (!previous) next.fill(ACTIVE_SLOT, 0, count(p, reference));
  const storage = makeArray(p, 'int', next);
  p.heap.withRoots([storage], () => {
    // Old dense snapshots may need allocating property writes. Publish the slot layout last,
    // so a failed metadata attachment still leaves every dense entry visible to readers.
    if (!previous) {
      p.set(reference, '$used', p.get(reference, '$used', count(p, reference)));
      p.set(reference, '$free', p.get(reference, '$free', -1));
    }
    p.set(reference, '$slots', storage);
  });
}

export function insertIndexed(p, reference, values, map) {
  const width = values.length;
  const used = p.get(reference, '$used', count(p, reference));
  const free = p.get(reference, '$free', -1);
  if (free < 0) reserveIndexed(p, reference, used + 1, width);
  const storage = p.get(reference, '$slots');
  const position = free < 0 ? used : free;
  const next = p.heap.get(storage).data[position];
  for (let offset = 0; offset < width; offset++) write(p, reference, position * width + offset, values[offset]);
  writeArray(p, storage, position, ACTIVE_SLOT);
  if (free < 0) p.set(reference, '$used', used + 1);
  else p.set(reference, '$free', next);
  p.set(reference, '$count', count(p, reference) + 1);
  change(p, reference);
  map.set(keyOf(p, values[0]), position);
  rememberIndex(p, reference, map);
}

export function removeIndexed(p, reference, lookup, width) {
  const {map, key, index} = lookup;
  if (!p.get(reference, '$slots')) {
    reserveIndexed(p, reference, count(p, reference), width);
    p.set(reference, '$used', count(p, reference));
  }
  for (let offset = 0; offset < width; offset++) write(p, reference, index * width + offset, null);
  writeArray(p, p.get(reference, '$slots'), index, p.get(reference, '$free', -1));
  p.set(reference, '$free', index);
  p.set(reference, '$count', count(p, reference) - 1);
  change(p, reference);
  map.delete(key);
  rememberIndex(p, reference, map);
}

export function clearIndexed(p, reference, width) {
  const used = p.get(reference, '$used', count(p, reference));
  if (!used) return;
  if (!p.get(reference, '$slots')) reserveIndexed(p, reference, used, width);
  const map = indexMap(p, reference, width);
  for (let index = 0; index < used * width; index++) write(p, reference, index, null);
  const size = count(p, reference);
  p.set(reference, '$count', 0);
  p.set(reference, '$used', 0);
  p.set(reference, '$free', -1);
  if (size) change(p, reference);
  map.clear();
  rememberIndex(p, reference, map);
}
