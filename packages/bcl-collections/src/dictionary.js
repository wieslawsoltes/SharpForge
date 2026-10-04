import {fail, makeArray} from '@sharpforge/bcl-core';
import {equal} from './object-equality.js';
import {dictionaryEntries} from './dictionary-entries.js';
import {data, change, write, keyOf, indexMap, rememberIndex} from './legacy-storage.js';
import {clearIndexed, insertIndexed, removeIndexed} from './indexed-storage.js';

function set(p, descriptor, context, lookup) {
  const {reference, values} = context;
  const {map, index} = lookup;
  const method = descriptor.name;
  if (index !== undefined) {
    if (method === 'Add') fail(p, 'ArgumentException', 'An item with the same key already exists');
    if (method === 'TryAdd') return p.managed(false, 'bool');
    write(p, reference, index * 2 + 1, values[1]);
    change(p, reference);
    rememberIndex(p, reference, map);
  } else {
    insertIndexed(p, reference, values, map);
  }
  return method === 'TryAdd' ? p.managed(true, 'bool') : null;
}

export function dictionary(p, descriptor, context) {
  const {reference, values, type} = context;
  const method = descriptor.name;
  if (method === 'Clear') {
    clearIndexed(p, reference, 2);
    return null;
  }
  if (method === 'get_Keys' || method === 'get_Values') {
    const keys = method === 'get_Keys';
    const items = Array.from(dictionaryEntries(p, reference), pair => pair[keys ? 0 : 1]);
    return makeArray(p, keys ? type.key : type.element, items);
  }
  if (method === 'ContainsValue') {
    for (const [, value] of dictionaryEntries(p, reference)) {
      if (equal(p, value, values[0])) return p.managed(true, 'bool');
    }
    return p.managed(false, 'bool');
  }
  if (values[0] === null) fail(p, 'ArgumentNullException', 'Dictionary key cannot be null');
  const map = indexMap(p, reference, 2);
  const key = keyOf(p, values[0]);
  const index = map.get(key);
  if (method === 'ContainsKey') return p.managed(index !== undefined, 'bool');
  if (method === 'get_Item') {
    if (index === undefined) fail(p, 'KeyNotFoundException', 'The given key was not present');
    return data(p, reference)[index * 2 + 1];
  }
  if (method === 'Remove') {
    if (index === undefined) return p.managed(false, 'bool');
    removeIndexed(p, reference, {map, key, index}, 2);
    return p.managed(true, 'bool');
  }
  if (method === 'Add' || method === 'TryAdd' || method === 'set_Item') {
    return set(p, descriptor, context, {map, index});
  }
  fail(p, 'MissingMethodException', descriptor.owner + '.' + method);
}
