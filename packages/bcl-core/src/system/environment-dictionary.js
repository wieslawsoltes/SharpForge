import {array, bclScalar, fail, integer, makeArray} from '../host.js';

const dictionary = 'System.Collections.IDictionary';
const collection = 'System.Collections.ICollection';
const enumerable = 'System.Collections.IEnumerable';
const enumerator = 'System.Collections.IEnumerator';
const dictionaryEnumerator = 'System.Collections.IDictionaryEnumerator';
const entry = 'System.Collections.DictionaryEntry';
const families = new Set(['environment-dictionary', 'environment-collection', 'environment-enumerator']);

/** Declare the standard non-generic dictionary signatures used by Environment.GetEnvironmentVariables. */
export function environmentDictionaryContracts({define, member, prop}) {
  define(enumerable, {kind: 'bcl14', family: 'environment-collection'});
  define(collection, {kind: 'bcl14', family: 'environment-collection', base: enumerable});
  define(dictionary, {kind: 'bcl14', family: 'environment-dictionary', base: collection});
  define(enumerator, {kind: 'bcl14', family: 'environment-enumerator'});
  define(dictionaryEnumerator, {kind: 'bcl14', family: 'environment-enumerator', base: enumerator});
  define(entry, {kind: 'value', base: 'System.ValueType', slots: ['Key', 'Value']});
  member(enumerable, 'GetEnumerator', [], enumerator);
  member(dictionary, 'GetEnumerator', [], dictionaryEnumerator);
  member(enumerator, 'MoveNext', [], 'bool');
  member(enumerator, 'Reset', [], 'void');
  prop(enumerator, 'Current', 'object', null, true);
  prop(dictionaryEnumerator, 'Entry', entry, null, true);
  prop(dictionaryEnumerator, 'Key', 'object', null, true);
  prop(dictionaryEnumerator, 'Value', 'object', null, true);
  prop(entry, 'Key', 'object', null, true);
  prop(entry, 'Value', 'object', null, true);
  prop(collection, 'Count', 'int', 0, true);
  prop(collection, 'IsSynchronized', 'bool', false, true);
  prop(collection, 'SyncRoot', 'object', null, true);
  member(collection, 'CopyTo', ['System.Array', 'int'], 'void');
  prop(dictionary, 'IsReadOnly', 'bool', false, true);
  prop(dictionary, 'IsFixedSize', 'bool', false, true);
  prop(dictionary, 'Keys', collection, null, true);
  prop(dictionary, 'Values', collection, null, true);
  member(dictionary, 'get_Item', ['object'], 'object');
  member(dictionary, 'set_Item', ['object', 'object'], 'void');
  member(dictionary, 'Contains', ['object'], 'bool');
  member(dictionary, 'Add', ['object', 'object'], 'void');
  member(dictionary, 'Remove', ['object'], 'void');
  member(dictionary, 'Clear', [], 'void');
}

function make(platform, type, items, values = {}) {
  const storage = makeArray(platform, 'object', items);
  return platform.heap.withRoots([storage], () => platform.make(type, {'$data': storage, '$version': 0, ...values}));
}

/** Each call returns a distinct mutable managed dictionary; its contents never change the session environment. */
export function createEnvironmentDictionary(platform, variables) {
  const items = [];
  return platform.heap.withRoots(items, () => {
    for (const [name, value] of Object.entries(variables)) {
      items.push(platform.managed(name, 'string'));
      items.push(platform.managed(value, 'string'));
    }
    return make(platform, dictionary, items);
  });
}

function key(platform, value) {
  if (value === null) fail(platform, 'ArgumentNullException', 'Dictionary key cannot be null');
  const scalar = bclScalar(platform, value);
  if (platform.bclHost.isReference(scalar)) return 'reference:' + scalar.h + ':' + scalar.g;
  if (['string', 'number', 'boolean', 'bigint'].includes(typeof scalar)) return typeof scalar + ':' + String(scalar);
  fail(platform, 'NotSupportedException', 'Environment dictionary key type is unsupported');
}

function index(platform, reference, items) {
  platform.environmentDictionaryIndexes ??= new WeakMap();
  const record = platform.record(reference);
  const previous = platform.environmentDictionaryIndexes.get(record);
  const version = platform.get(reference, '$version');
  if (previous?.version === version && previous.items === items) return previous.index;
  const result = new Map();
  for (let at = 0; at < items.length; at += 2) result.set(key(platform, items[at]), at);
  platform.environmentDictionaryIndexes.set(record, {items, version, index: result});
  return result;
}

function replace(platform, reference, items) {
  const storage = makeArray(platform, 'object', items);
  platform.heap.withRoots([storage], () => platform.set(reference, '$data', storage));
  platform.set(reference, '$version', platform.get(reference, '$version') + 1);
}

function position(platform, reference) {
  const owner = platform.get(reference, '$owner');
  if (platform.get(owner, '$version') !== platform.get(reference, '$version')) {
    fail(platform, 'InvalidOperationException', 'Dictionary changed during enumeration');
  }
  const items = array(platform, platform.get(owner, '$data'));
  return {owner, items, stride: platform.record(owner).type === dictionary ? 2 : 1, index: platform.get(reference, '$index')};
}

function next(platform, descriptor, reference) {
  const current = position(platform, reference);
  const {items, stride} = current;
  if (descriptor.name === 'Reset') { platform.set(reference, '$index', -1); return null; }
  if (descriptor.name === 'MoveNext') {
    platform.set(reference, '$index', current.index + 1);
    return platform.managed((current.index + 1) * stride < items.length, 'bool');
  }
  const at = current.index * stride;
  if (at < 0 || at >= items.length) fail(platform, 'InvalidOperationException', 'Enumerator is not positioned on an item');
  if (descriptor.name === 'get_Key') return items[at];
  if (descriptor.name === 'get_Value') return items[at + 1];
  if (descriptor.name === 'get_Entry' || descriptor.name === 'get_Current') {
    return stride === 1 ? items[at] : platform.make(entry, {Key: items[at], Value: items[at + 1]});
  }
  fail(platform, 'MissingMethodException', descriptor.owner + '.' + descriptor.name);
}

function common(platform, descriptor, args, items, stride) {
  const reference = args[0];
  switch (descriptor.name) {
    case 'get_Count': return items.length / stride;
    case 'get_IsReadOnly': case 'get_IsFixedSize': case 'get_IsSynchronized': return platform.managed(false, 'bool');
    case 'get_SyncRoot': return reference;
    case 'GetEnumerator':
      return platform.make(descriptor.result, {'$owner': reference, '$index': -1, '$version': platform.get(reference, '$version')});
    case 'CopyTo': {
      const destination = array(platform, args[1]);
      const start = integer(platform, platform.native(args[2]), 0, destination.length);
      if (destination.length - start < items.length / stride) fail(platform, 'ArgumentException', 'Destination array is too small');
      for (let at = 0; at < items.length; at += stride) {
        destination[start + at / stride] = stride === 1 ? items[at] : platform.make(entry, {Key: items[at], Value: items[at + 1]});
      }
      return null;
    }
    default: return undefined;
  }
}

function operate(platform, descriptor, args, items) {
  const reference = args[0];
  const name = descriptor.name;
  if (name === 'get_Keys' || name === 'get_Values') {
    return make(platform, collection, items.filter((_, at) => at % 2 === (name === 'get_Keys' ? 0 : 1)));
  }
  if (name === 'Clear') { replace(platform, reference, []); return null; }
  const positions = index(platform, reference, items);
  const at = positions.get(key(platform, args[1]));
  if (name === 'Contains') return platform.managed(at !== undefined, 'bool');
  if (name === 'get_Item') return at === undefined ? null : items[at + 1];
  if (name === 'Add' && at !== undefined) fail(platform, 'ArgumentException', 'An item with the same key already exists');
  const updated = [...items];
  if (name === 'Remove') {
    if (at !== undefined) updated.splice(at, 2);
  } else if (name === 'Add' || name === 'set_Item') {
    if (at === undefined) updated.push(args[1], args[2]);
    else updated[at + 1] = args[2];
  } else fail(platform, 'MissingMethodException', descriptor.owner + '.' + name);
  replace(platform, reference, updated);
  return null;
}

export function invokeEnvironmentDictionary(platform, descriptor, args, type) {
  if (!families.has(type.family)) return {handled: false};
  if (type.family === 'environment-enumerator') return {handled: true, value: next(platform, descriptor, args[0])};
  const items = array(platform, platform.get(args[0], '$data'));
  const stride = platform.record(args[0]).type === dictionary ? 2 : 1;
  const value = common(platform, descriptor, args, items, stride);
  return {handled: true, value: value === undefined ? operate(platform, descriptor, args, items) : value};
}
