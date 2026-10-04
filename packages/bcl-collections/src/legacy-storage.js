import {MAX, integer, makeArray} from '@sharpforge/bcl-core';
import {keyOf} from './object-equality.js';

export {keyOf} from './object-equality.js';

export const ACTIVE_SLOT = -2;

export function count(p, reference) {
  return p.get(reference, '$count', 0);
}

export function data(p, reference) {
  const storage = p.get(reference, '$data');
  return storage ? p.heap.get(storage).data : [];
}

export function version(p, reference) {
  return p.get(reference, '$version', 0);
}

export function change(p, reference) {
  p.set(reference, '$version', version(p, reference) + 1);
}

export function reserve(p, reference, needed, slots = 1) {
  integer(p, needed);
  const previous = data(p, reference);
  const capacity = previous.length / slots;
  if (needed <= capacity) return;
  const size = Math.min(MAX, Math.max(needed, capacity ? capacity * 2 : 4));
  const items = previous.concat(Array(size * slots - previous.length).fill(null));
  const storage = makeArray(p, 'object', items);
  p.heap.withRoots([storage], () => p.set(reference, '$data', storage));
}

export function commitItems(p, reference, items, slots = 1) {
  const size = items.length / slots;
  integer(p, size);
  reserve(p, reference, size, slots);
  const next = Array(data(p, reference).length).fill(null);
  items.forEach((value, index) => next[index] = value);
  p.heap.replaceData(p.get(reference, '$data'), next);
  p.set(reference, '$count', size);
  change(p, reference);
}

export function write(p, reference, index, value) {
  writeArray(p, p.get(reference, '$data'), index, value);
}

export function writeArray(p, storage, index, value) {
  const record = p.heap.get(storage);
  const oldValue = record.data[index];
  record.data[index] = value;
  p.vm.notifyWrite?.({kind: 'array', handle: storage.h, generation: storage.g, index, oldValue, value});
}

/** Dense collections retain their prefix; indexed collections skip released slots. */
export function* positions(p, reference) {
  const slots = p.get(reference, '$slots');
  const states = slots ? p.heap.get(slots).data : null;
  const length = states ? p.get(reference, '$used', 0) : count(p, reference);
  for (let position = 0; position < length; position++) {
    if (!states || states[position] === ACTIVE_SLOT) yield position;
  }
}

export function rememberIndex(p, reference, index) {
  p.bclIndexes.set(p.record(reference), {version: version(p, reference), index});
}

export function queueItems(p, reference) {
  const items = data(p, reference);
  const head = p.get(reference, '$head', 0);
  return Array.from({length: count(p, reference)}, (_, index) => items[(head + index) % items.length]);
}

export function queueEnqueue(p, reference, value) {
  const size = count(p, reference);
  integer(p, size + 1);
  if (size === data(p, reference).length) {
    const items = queueItems(p, reference);
    reserve(p, reference, size + 1);
    const next = Array(data(p, reference).length).fill(null);
    items.forEach((item, index) => next[index] = item);
    p.heap.replaceData(p.get(reference, '$data'), next);
    p.set(reference, '$head', 0);
  }
  write(p, reference, (p.get(reference, '$head', 0) + size) % data(p, reference).length, value);
  p.set(reference, '$count', size + 1);
  change(p, reference);
}

export function append(p, reference, value) {
  const size = count(p, reference);
  reserve(p, reference, size + 1);
  write(p, reference, size, value);
  p.set(reference, '$count', size + 1);
  change(p, reference);
}

export function indexMap(p, reference, slots = 1) {
  const record = p.record(reference);
  const revision = version(p, reference);
  p.bclIndexes ??= new WeakMap();
  let cache = p.bclIndexes.get(record);
  if (cache?.version !== revision) {
    const index = new Map();
    const items = data(p, reference);
    for (const position of positions(p, reference)) {
      index.set(keyOf(p, items[position * slots]), position);
    }
    cache = {version: revision, index};
    p.bclIndexes.set(record, cache);
  }
  return cache.index;
}
