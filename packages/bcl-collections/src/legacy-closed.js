import {fail, integer, bclScalar, array, makeArray, equal} from '@sharpforge/bcl-core';
import {registerClosedCollections} from './legacy-contracts.js';
import {
  count, data, version, change, reserve, commitItems, write, queueItems, queueEnqueue, append, keyOf, indexMap
} from './legacy-storage.js';

const families = Object.freeze(['List', 'HashSet', 'Queue', 'Stack', 'Dictionary', 'enumerator']);

function construct(p, descriptor, context) {
  const {native, values, family} = context;
  if (native.length === 1 && typeof native[0] === 'number') integer(p, native[0]);
  const reference = p.make(descriptor.owner, {'$count': 0, '$version': 0});
  p.heap.pins.push(reference);
  if (descriptor.parameters[0]?.endsWith('[]')) {
    const items = array(p, values[0]);
    const initial = family === 'HashSet' ? items.filter((value, index) => items.findIndex(item => equal(p, value, item)) === index) : items;
    commitItems(p, reference, initial);
  } else if (native[0]) {
    reserve(p, reference, native[0], family === 'Dictionary' ? 2 : 1);
  }
  return reference;
}

function enumerator(p, descriptor, reference) {
  const method = descriptor.name;
  if (method === 'Dispose') {
    p.set(reference, '$owner', null);
    return null;
  }
  const owner = p.get(reference, '$owner');
  if (!owner) fail(p, 'ObjectDisposedException', 'Enumerator is disposed');
  if (version(p, owner) !== p.get(reference, '$version')) {
    fail(p, 'InvalidOperationException', 'Collection was modified during enumeration');
  }
  if (method === 'MoveNext') {
    const index = p.get(reference, '$index', -1) + 1;
    p.set(reference, '$index', index);
    return p.managed(index < count(p, owner), 'bool');
  }
  if (method !== 'get_Current') fail(p, 'MissingMethodException', descriptor.owner + '.' + method);
  const index = p.get(reference, '$index', -1);
  if (index < 0 || index >= count(p, owner)) fail(p, 'InvalidOperationException', 'Enumerator is not positioned on an item');
  const type = p.bclHost.frameworkType(p.record(owner).type);
  const position = type.family === 'Stack' ? count(p, owner) - 1 - index
    : type.family === 'Queue' ? (p.get(owner, '$head', 0) + index) % data(p, owner).length : index;
  return data(p, owner)[position];
}

function dictionarySet(p, descriptor, context, lookup) {
  const {reference, values, size} = context;
  const {map, key, index} = lookup;
  const method = descriptor.name;
  if (index !== undefined) {
    if (method === 'Add') fail(p, 'ArgumentException', 'An item with the same key already exists');
    if (method === 'TryAdd') return p.managed(false, 'bool');
    write(p, reference, index * 2 + 1, values[1]);
    change(p, reference);
  } else {
    reserve(p, reference, size + 1, 2);
    write(p, reference, size * 2, values[0]);
    write(p, reference, size * 2 + 1, values[1]);
    p.set(reference, '$count', size + 1);
    change(p, reference);
    map.set(key, size);
  }
  p.bclIndexes.set(p.record(reference), {version: version(p, reference), index: map});
  return method === 'TryAdd' ? p.managed(true, 'bool') : null;
}

function dictionary(p, descriptor, context) {
  const {reference, values, size, type} = context;
  const method = descriptor.name;
  if (method === 'get_Keys' || method === 'get_Values') {
    const keys = method === 'get_Keys';
    const items = Array.from({length: size}, (_, index) => data(p, reference)[index * 2 + (keys ? 0 : 1)]);
    return makeArray(p, keys ? type.key : type.element, items);
  }
  if (method === 'ContainsValue') {
    const items = Array.from({length: size}, (_, index) => data(p, reference)[index * 2 + 1]);
    return p.managed(items.some(value => equal(p, value, values[0])), 'bool');
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
    const items = data(p, reference).slice(0, size * 2);
    items.splice(index * 2, 2);
    commitItems(p, reference, items, 2);
    return p.managed(true, 'bool');
  }
  if (method === 'Add' || method === 'TryAdd' || method === 'set_Item') {
    return dictionarySet(p, descriptor, context, {map, key, index});
  }
  fail(p, 'MissingMethodException', descriptor.owner + '.' + method);
}

function add(p, context) {
  const {reference, values, family, size} = context;
  if (family === 'Queue') {
    queueEnqueue(p, reference, values[0]);
    return null;
  }
  const map = family === 'HashSet' ? indexMap(p, reference) : null;
  const key = map ? keyOf(p, values[0]) : null;
  if (map?.has(key)) return p.managed(false, 'bool');
  append(p, reference, values[0]);
  if (map) {
    map.set(key, size);
    p.bclIndexes.set(p.record(reference), {version: version(p, reference), index: map});
  }
  return family === 'HashSet' ? p.managed(true, 'bool') : null;
}

function peekOrRemove(p, descriptor, context) {
  const {reference, family, size} = context;
  if (!size) fail(p, 'InvalidOperationException', 'Collection is empty');
  const index = family === 'Stack' ? size - 1 : p.get(reference, '$head', 0);
  const value = data(p, reference)[index];
  if (descriptor.name !== 'Peek') {
    p.heap.withRoots([value], () => {
      write(p, reference, index, null);
      p.set(reference, '$count', size - 1);
      if (family === 'Queue') p.set(reference, '$head', size === 1 ? 0 : (index + 1) % data(p, reference).length);
      change(p, reference);
    });
  }
  return value;
}

function compare(p, left, right) {
  const first = bclScalar(p, left);
  const second = bclScalar(p, right);
  if (first === second) return 0;
  if (first === null) return -1;
  if (second === null) return 1;
  if (typeof first === 'number' && typeof second === 'number') {
    return Number.isNaN(first) ? -1 : Number.isNaN(second) ? 1 : first - second;
  }
  if (typeof first === 'string' && typeof second === 'string' || typeof first === 'boolean' && typeof second === 'boolean') {
    return first < second ? -1 : 1;
  }
  fail(p, 'InvalidOperationException', 'Default comparer is unavailable for this object type');
}

function setOperation(p, method, items, values) {
  const other = new Set(array(p, values[0]).map(value => keyOf(p, value)));
  const seen = new Set(items.map(value => keyOf(p, value)));
  if (method === 'UnionWith') {
    for (const value of array(p, values[0])) {
      if (seen.has(keyOf(p, value))) continue;
      seen.add(keyOf(p, value));
      items.push(value);
    }
  } else {
    for (let index = items.length - 1; index >= 0; index--) {
      if (other.has(keyOf(p, items[index])) === (method === 'ExceptWith')) items.splice(index, 1);
    }
  }
}

function mutate(p, descriptor, context) {
  const {reference, values, native, size} = context;
  const items = data(p, reference).slice(0, size);
  switch (descriptor.name) {
    case 'AddRange': {
      const extra = array(p, values[0]);
      integer(p, items.length + extra.length);
      for (const value of extra) items.push(value);
      break;
    }
    case 'Insert': items.splice(integer(p, native[0], 0, size), 0, values[1]); break;
    case 'RemoveAt': items.splice(integer(p, native[0], 0, size - 1), 1); break;
    case 'RemoveRange': items.splice(integer(p, native[0], 0, size), integer(p, native[1], 0, size - native[0])); break;
    case 'Remove': {
      const index = items.findIndex(value => equal(p, value, values[0]));
      if (index < 0) return p.managed(false, 'bool');
      items.splice(index, 1);
      commitItems(p, reference, items);
      return p.managed(true, 'bool');
    }
    case 'Reverse': items.reverse(); break;
    case 'Sort': items.sort((left, right) => compare(p, left, right)); break;
    case 'UnionWith': case 'IntersectWith': case 'ExceptWith':
      setOperation(p, descriptor.name, items, values);
      break;
    default: fail(p, 'MissingMethodException', descriptor.owner + '.' + descriptor.name);
  }
  commitItems(p, reference, items);
  return null;
}

function invokeMember(p, descriptor, context) {
  const {reference, values, native, family, size, type} = context;
  const method = descriptor.name;
  if (method === 'get_Count') return size;
  if (method === 'get_Capacity') return data(p, reference).length;
  if (method === 'set_Capacity') {
    integer(p, native[0], size);
    const items = data(p, reference).slice(0, native[0]);
    while (items.length < native[0]) items.push(null);
    const storage = makeArray(p, 'object', items);
    p.heap.withRoots([storage], () => p.set(reference, '$data', storage));
    return null;
  }
  if (method === 'Clear') {
    if (size) commitItems(p, reference, [], family === 'Dictionary' ? 2 : 1);
    if (family === 'Queue') p.set(reference, '$head', 0);
    return null;
  }
  if (method === 'GetEnumerator') {
    return p.make(descriptor.result, {'$owner': reference, '$index': -1, '$version': version(p, reference)});
  }
  if (method === 'ToArray') {
    const items = family === 'Queue' ? queueItems(p, reference)
      : family === 'Stack' ? data(p, reference).slice(0, size).reverse() : data(p, reference).slice(0, size);
    return makeArray(p, type.element, items);
  }
  if (family === 'Dictionary') return dictionary(p, descriptor, context);
  if (method === 'Contains' || method === 'IndexOf') {
    const index = family === 'HashSet' ? indexMap(p, reference).get(keyOf(p, values[0])) ?? -1
      : (family === 'Queue' ? queueItems(p, reference) : data(p, reference).slice(0, size))
        .findIndex(value => equal(p, value, values[0]));
    return method === 'Contains' ? p.managed(index >= 0, 'bool') : index;
  }
  if (method === 'get_Item') return data(p, reference)[integer(p, native[0], 0, size - 1)];
  if (method === 'set_Item') {
    const index = integer(p, native[0], 0, size - 1);
    write(p, reference, index, values[1]);
    change(p, reference);
    return null;
  }
  if (method === 'Add' || method === 'Enqueue' || method === 'Push') return add(p, context);
  if (method === 'Peek' || method === 'Dequeue' || method === 'Pop') return peekOrRemove(p, descriptor, context);
  return mutate(p, descriptor, context);
}

function invoke(p, descriptor, args, type = p.bclHost.frameworkType(descriptor.owner)) {
  if (type?.kind !== 'bcl' || !families.includes(type.family)) return {handled: false};
  const reference = descriptor.isStatic || descriptor.kind === 'constructor' ? null : args[0];
  const values = reference === null ? args : args.slice(1);
  const native = values.map(value => bclScalar(p, value));
  const context = {reference, values, native, family: type.family, type, size: 0};
  if (descriptor.kind === 'constructor') return {handled: true, value: construct(p, descriptor, context)};
  p.record(reference);
  if (type.family === 'enumerator') return {handled: true, value: enumerator(p, descriptor, reference)};
  context.size = count(p, reference);
  return {handled: true, value: invokeMember(p, descriptor, context)};
}

/** Released closed collections with heap-owned GC/debugger state and unchanged ABI registration order. */
export const closedCollectionsModule = Object.freeze({
  name: 'closed-collections', families, group: 'bcl-collections', contracts: registerClosedCollections, invoke
});
