import {registerOrderingExtensions} from './comparers/contracts.js';
import {sortList} from './list-sort.js';
import {fail, integer, bclScalar, array, makeArray} from '@sharpforge/bcl-core';
import {equal} from './object-equality.js';
import {registerClosedCollections} from './legacy-contracts.js';
import {dictionary} from './dictionary.js';
import {hashSet, initializeHashSet} from './hash-set.js';
import {collectionEnumerator} from './collection-enumerator.js';
import {listRemoval} from './list-removal.js';
import {clearList, removeListValue} from './list-value-removal.js';
import {listInsertion} from './list-insertion.js';
import {reverseList} from './list-reverse.js';
import {reserveIndexed} from './indexed-storage.js';
import {
  count, data, version, change, reserve, commitItems, write, queueItems, queueEnqueue, append
} from './legacy-storage.js';

const families = Object.freeze(['List', 'HashSet', 'Queue', 'Stack', 'Dictionary', 'enumerator']);

function construct(p, descriptor, context) {
  const {native, values, family} = context;
  if (native.length === 1 && typeof native[0] === 'number') integer(p, native[0]);
  const state = {'$count': 0, '$version': 0};
  if (family === 'Dictionary' || family === 'HashSet') Object.assign(state, {'$used': 0, '$free': -1, '$slots': null});
  const reference = p.make(descriptor.owner, state);
  p.heap.pins.push(reference);
  if (descriptor.parameters[0]?.endsWith('[]')) {
    const items = array(p, values[0]);
    if (family === 'HashSet') initializeHashSet(p, reference, items);
    else commitItems(p, reference, items);
  } else if (native[0]) {
    if (family === 'Dictionary' || family === 'HashSet') reserveIndexed(p, reference, native[0], family === 'Dictionary' ? 2 : 1);
    else reserve(p, reference, native[0]);
  }
  return reference;
}

function add(p, context) {
  const {reference, values, family} = context;
  if (family === 'Queue') queueEnqueue(p, reference, values[0]);
  else append(p, reference, values[0]);
  return null;
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

function mutate(p, descriptor, context) {
  if (descriptor.name === 'RemoveAt' || descriptor.name === 'RemoveRange') return listRemoval(p, descriptor, context);
  if (descriptor.name === 'Remove') return removeListValue(p, context.reference, context.values[0]);
  if (descriptor.name === 'Insert' || descriptor.name === 'AddRange') return listInsertion(p, descriptor, context);
  if (descriptor.name === 'Sort') return sortList(p, context.reference, context.values[0] ?? null);
  if (descriptor.name === 'Reverse') return reverseList(p, context.reference);
  fail(p, 'MissingMethodException', descriptor.owner + '.' + descriptor.name);
}

function invokeMember(p, descriptor, context) {
  const {reference, values, native, family, size, type} = context;
  const method = descriptor.name;
  if (method === 'get_Count') return size;
  if (family === 'Dictionary') return dictionary(p, descriptor, context);
  if (method === 'GetEnumerator') {
    return p.make(descriptor.result, {'$owner': reference, '$index': -1, '$version': version(p, reference)});
  }
  if (family === 'HashSet') return hashSet(p, descriptor, context);
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
    if (family === 'List') return clearList(p, reference);
    if (size) commitItems(p, reference, []);
    if (family === 'Queue') p.set(reference, '$head', 0);
    return null;
  }
  if (method === 'ToArray') {
    const items = family === 'Queue' ? queueItems(p, reference)
      : family === 'Stack' ? data(p, reference).slice(0, size).reverse() : data(p, reference).slice(0, size);
    return makeArray(p, type.element, items);
  }
  if (method === 'Contains' || method === 'IndexOf') {
    const items = family === 'Queue' ? queueItems(p, reference) : data(p, reference).slice(0, size);
    const index = items.findIndex(value => equal(p, value, values[0]));
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
  if (type.family === 'enumerator') return {handled: true, value: collectionEnumerator(p, descriptor, reference)};
  context.size = count(p, reference);
  return {handled: true, value: invokeMember(p, descriptor, context)};
}

/** Released closed collections with heap-owned GC/debugger state and unchanged ABI registration order. */
export const closedCollectionsModule = Object.freeze({
  name: 'closed-collections', families, group: 'bcl-collections', contracts: registerClosedCollections,
  extensionContracts: registerOrderingExtensions, invoke
});
