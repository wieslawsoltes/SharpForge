import {array, fail, makeArray} from '@sharpforge/bcl-core';
import {hashSetValues} from './hashset-values.js';
import {count, data, version, positions, keyOf, indexMap, rememberIndex} from './legacy-storage.js';
import {clearIndexed, insertIndexed, removeIndexed, reserveIndexed} from './indexed-storage.js';

function add(p, reference, value, map) {
  if (map.has(keyOf(p, value))) return false;
  insertIndexed(p, reference, [value], map);
  return true;
}

function remove(p, reference, value, map) {
  const key = keyOf(p, value);
  const index = map.get(key);
  if (index === undefined) return false;
  removeIndexed(p, reference, {map, key, index}, 1);
  return true;
}

/** Construct the released array-input profile with one observable initial version. */
export function initializeHashSet(p, reference, items) {
  const map = indexMap(p, reference);
  for (const value of items) add(p, reference, value, map);
  p.set(reference, '$version', 1);
  rememberIndex(p, reference, map);
}

function union(p, reference, items, map) {
  const additions = [];
  const seen = new Set();
  for (const value of items) {
    const key = keyOf(p, value);
    if (!map.has(key) && !seen.has(key)) additions.push(value);
    seen.add(key);
  }
  if (!additions.length) return;
  const used = p.get(reference, '$used', count(p, reference));
  reserveIndexed(p, reference, Math.max(used, count(p, reference) + additions.length), 1);
  for (const value of additions) insertIndexed(p, reference, [value], map);
}

function intersect(p, reference, items, map) {
  if (!count(p, reference)) return;
  if (!items.length) {
    clearIndexed(p, reference, 1);
    return;
  }
  const keep = new Set(items.map(value => keyOf(p, value)));
  const values = data(p, reference);
  for (const index of positions(p, reference)) {
    const key = keyOf(p, values[index]);
    if (!keep.has(key)) removeIndexed(p, reference, {map, key, index}, 1);
  }
}

function setOperation(p, reference, method, argument) {
  const items = array(p, argument);
  const map = indexMap(p, reference);
  const revision = version(p, reference);
  if (method === 'UnionWith') union(p, reference, items, map);
  else if (method === 'IntersectWith') intersect(p, reference, items, map);
  else for (const value of items) remove(p, reference, value, map);
  // The released profile invalidates enumerators once per bulk call, including a no-op call.
  p.set(reference, '$version', revision + 1);
  rememberIndex(p, reference, map);
  return null;
}

export function hashSet(p, descriptor, context) {
  const {reference, values, type} = context;
  const method = descriptor.name;
  if (method === 'Clear') {
    clearIndexed(p, reference, 1);
    return null;
  }
  if (method === 'ToArray') return makeArray(p, type.element, [...hashSetValues(p, reference)]);
  if (method === 'UnionWith' || method === 'IntersectWith' || method === 'ExceptWith') {
    return setOperation(p, reference, method, values[0]);
  }
  const map = indexMap(p, reference);
  if (method === 'Contains') return p.managed(map.has(keyOf(p, values[0])), 'bool');
  if (method === 'Add') return p.managed(add(p, reference, values[0], map), 'bool');
  if (method === 'Remove') return p.managed(remove(p, reference, values[0], map), 'bool');
  fail(p, 'MissingMethodException', descriptor.owner + '.' + method);
}
