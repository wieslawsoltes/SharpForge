import {MAX, array, bclScalar, bounded, fail, integer, makeArray, string, text} from '../host.js';
import {appendCompositeFormat} from '../formatting/composite-format.js';
import {appendBuilderCharacter} from './string-builder-append.js';
import {accessBuilderCharacter} from './string-builder-indexer.js';
import {copyBuilderCharacters} from './string-builder-copy.js';
import {appendBuilderRange} from './string-builder-append-range.js';
import {appendBuilderArray} from './string-builder-append-array.js';

const owner = 'System.Text.StringBuilder';
const maximumCapacity = 2147483647;

/** Register StringBuilder in its released ABI order with the .NET default MaxCapacity. */
export function registerStringBuilder({define, member, ctor, prop}) {
  define(owner, {kind: 'bcl', family: 'builder', defaultMember: 'Chars'});
  for (const parameters of [[], ['int'], ['string'], ['string', 'int']]) ctor(owner, parameters);
  prop(owner, 'Length', 'int', 0);
  prop(owner, 'Capacity', 'int', 16);
  prop(owner, 'MaxCapacity', 'int', maximumCapacity, true);
  for (const type of ['int', 'double', 'bool', 'string', 'object']) member(owner, 'Append', [type], owner);
  for (const parameters of [[], ['string']]) member(owner, 'AppendLine', parameters, owner);
  const methods = [
    ['Clear', [], owner],
    ['ToString', [], 'string', {objectToStringOverride: true}],
    ['ToString', ['int', 'int'], 'string'],
    ['Insert', ['int', 'string'], owner],
    ['Remove', ['int', 'int'], owner],
    ['Replace', ['string', 'string'], owner],
    ['EnsureCapacity', ['int'], 'int']
  ];
  for (const [name, parameters, result, options] of methods) member(owner, name, parameters, result, options);
  for (let count = 1; count <= 3; count++) {
    member(owner, 'AppendFormat', ['string', ...Array(count).fill('object')], owner);
  }
}

/** Add genuine params-array binding in A07's reserved range without moving released contracts. */
export function registerStringBuilderExtensions({member}) {
  member(owner, 'AppendFormat', ['string', 'object[]'], owner, {paramsIndex: 1});
}

function capacity(platform, value, minimum = 0) {
  integer(platform, value, minimum, maximumCapacity);
  if (value > MAX) fail(platform, 'OutOfMemoryException', 'StringBuilder host text allocation limit exceeded');
  return value;
}

function chunks(platform, reference) {
  const storage = platform.get(reference, '$data');
  return storage ? platform.heap.get(storage).data : [];
}

function reserve(platform, reference, needed) {
  integer(platform, needed);
  const previous = chunks(platform, reference);
  const capacity = previous.length;
  if (needed <= capacity) return;
  const length = Math.min(MAX, Math.max(needed, capacity ? capacity * 2 : 4));
  const items = previous.concat(Array(length - previous.length).fill(null));
  const storage = makeArray(platform, 'object', items);
  platform.heap.withRoots([storage], () => platform.set(reference, '$data', storage));
}

function commitChunks(platform, reference, items) {
  integer(platform, items.length);
  reserve(platform, reference, items.length);
  const next = Array(chunks(platform, reference).length).fill(null);
  items.forEach((value, index) => { next[index] = value; });
  const storage = platform.get(reference, '$data');
  if (storage) platform.heap.replaceData(storage, next);
  platform.set(reference, '$count', items.length);
  platform.set(reference, '$version', platform.get(reference, '$version', 0) + 1);
}

function appendChunk(platform, reference, value) {
  const count = platform.get(reference, '$count', 0);
  reserve(platform, reference, count + 1);
  const storage = platform.get(reference, '$data');
  const record = platform.heap.get(storage);
  const oldValue = record.data[count];
  record.data[count] = value;
  platform.vm.notifyWrite?.({kind: 'array', handle: storage.h, generation: storage.g, index: count, oldValue, value});
  platform.set(reference, '$count', count + 1);
  platform.set(reference, '$version', platform.get(reference, '$version', 0) + 1);
}

function bufferText(platform, reference) {
  const count = platform.get(reference, '$count', 0);
  return bounded(platform, chunks(platform, reference).slice(0, count).map(value => string(platform, value)).join(''));
}

function setBuffer(platform, reference, value) {
  bounded(platform, value);
  const chunk = platform.heap.string(value);
  platform.heap.withRoots([chunk], () => commitChunks(platform, reference, value ? [chunk] : []));
  platform.set(reference, '$length', value.length);
  platform.set(reference, '$capacity', Math.max(value.length, platform.get(reference, '$capacity', 16)));
}

function appendText(platform, reference, value) {
  bounded(platform, value);
  const length = platform.get(reference, '$length', 0) + value.length;
  if (length > MAX) fail(platform, 'OutOfMemoryException', 'StringBuilder text limit');
  if (value) {
    const chunk = platform.heap.string(value);
    platform.heap.withRoots([chunk], () => appendChunk(platform, reference, chunk));
  }
  platform.set(reference, '$length', length);
  platform.set(reference, '$capacity', Math.max(length, platform.get(reference, '$capacity', 16)));
  return reference;
}

function construct(platform, descriptor, scalars) {
  if (scalars.length === 1 && typeof scalars[0] === 'number') capacity(platform, scalars[0]);
  if (scalars.length === 2) capacity(platform, scalars[1]);
  const reference = platform.make(descriptor.owner, {'$count': 0, '$version': 0});
  platform.heap.pins.push(reference);
  const initialCapacity = scalars.length === 1 && typeof scalars[0] === 'number' ? scalars[0] : scalars[1] ?? 16;
  platform.set(reference, '$capacity', initialCapacity || 16);
  platform.set(reference, '$length', 0);
  if (typeof scalars[0] === 'string') appendText(platform, reference, scalars[0]);
  return reference;
}

function mutateBuffer(platform, reference, name, values, scalars) {
  switch (name) {
    case 'Clear':
      setBuffer(platform, reference, '');
      return reference;
    case 'set_Length': {
      const length = capacity(platform, scalars[0]);
      const previous = bufferText(platform, reference);
      setBuffer(platform, reference, length > previous.length
        ? previous + '\0'.repeat(length - previous.length)
        : previous.slice(0, length));
      return null;
    }
    case 'Insert': {
      const previous = bufferText(platform, reference);
      const start = integer(platform, scalars[0], 0, previous.length);
      capacity(platform, previous.length + (scalars[1]?.length ?? 0));
      setBuffer(platform, reference, previous.slice(0, start) + (scalars[1] ?? '') + previous.slice(start));
      return reference;
    }
    case 'Remove': {
      const previous = bufferText(platform, reference);
      const start = integer(platform, scalars[0], 0, previous.length);
      const length = integer(platform, scalars[1], 0, previous.length - start);
      setBuffer(platform, reference, previous.slice(0, start) + previous.slice(start + length));
      return reference;
    }
    case 'Replace': {
      const previous = string(platform, values[0]);
      if (!previous) fail(platform, 'ArgumentException', 'Old value cannot be empty');
      const source = bufferText(platform, reference);
      const replacement = scalars[1] ?? '';
      if (replacement.length > previous.length) {
        let occurrences = 0;
        let position = source.indexOf(previous);
        while (position >= 0) {
          occurrences++;
          position = source.indexOf(previous, position + previous.length);
        }
        const length = source.length + occurrences * (replacement.length - previous.length);
        if (length > MAX) fail(platform, 'OutOfMemoryException', 'StringBuilder host text allocation limit exceeded');
      }
      setBuffer(platform, reference, source.split(previous).join(replacement));
      return reference;
    }
    default: fail(platform, 'MissingMethodException', name);
  }
}

function appendFormat(platform, descriptor, reference, values) {
  const format = string(platform, values[0]);
  let args = values.slice(1);
  if (descriptor.paramsIndex === 1) {
    if (values[1] === null) fail(platform, 'ArgumentNullException', 'Format arguments are required');
    args = array(platform, values[1]);
  }
  appendCompositeFormat(platform, format, args, value => appendText(platform, reference, value));
  return reference;
}

function invokeMember(platform, descriptor, reference, values, scalars) {
  switch (descriptor.name) {
    case 'CopyTo': return copyBuilderCharacters(platform, reference, values, scalars);
    case 'get_Chars':
    case 'set_Chars': return accessBuilderCharacter(platform, reference, scalars);
    case 'get_Length': return platform.get(reference, '$length', 0);
    case 'get_Capacity': return platform.get(reference, '$capacity', 16);
    case 'get_MaxCapacity': return maximumCapacity;
    case 'set_Capacity':
      capacity(platform, scalars[0], platform.get(reference, '$length', 0));
      platform.set(reference, '$capacity', scalars[0]);
      return null;
    case 'Append':
      if (descriptor.parameters[0] === 'char[]') return appendBuilderArray(platform, reference, values, scalars, appendText);
      if (descriptor.parameters.length === 3) return appendBuilderRange(platform, reference, scalars, appendText);
      return descriptor.parameters[0] === 'char'
        ? appendBuilderCharacter(platform, reference, scalars, appendText)
        : appendText(platform, reference, text(platform, values[0], descriptor.parameters[0]));
    case 'AppendLine': return appendText(platform, reference, (values.length ? text(platform, values[0]) : '') + '\n');
    case 'AppendFormat': return appendFormat(platform, descriptor, reference, values);
    case 'EnsureCapacity':
      capacity(platform, scalars[0]);
      platform.set(reference, '$capacity', Math.max(scalars[0], platform.get(reference, '$capacity', 16)));
      return platform.get(reference, '$capacity');
    case 'ToString': {
      const value = bufferText(platform, reference);
      const start = values.length ? integer(platform, scalars[0], 0, value.length) : 0;
      const length = values.length ? integer(platform, scalars[1], 0, value.length - start) : value.length;
      return platform.heap.string(value.slice(start, start + length));
    }
    default: return mutateBuffer(platform, reference, descriptor.name, values, scalars);
  }
}

/** Invoke StringBuilder using only managed chunk references, so collection and snapshots preserve all text. */
export function invokeStringBuilder(platform, descriptor, args) {
  const reference = descriptor.isStatic || descriptor.kind === 'constructor' ? null : args[0];
  const values = reference === null ? args : args.slice(1);
  const scalars = values.map(value => bclScalar(platform, value));
  if (descriptor.kind === 'constructor') return {handled: true, value: construct(platform, descriptor, scalars)};
  platform.record(reference);
  return {handled: true, value: invokeMember(platform, descriptor, reference, values, scalars)};
}

export const stringBuilderModule = Object.freeze({
  name: 'string-builder',
  families: Object.freeze(['builder']),
  contracts: registerStringBuilder,
  extensionContracts: registerStringBuilderExtensions,
  invoke: invokeStringBuilder
});
