import {searchWithComparer, binarySearchIndices} from './array-search.js';
import {nativeEqual as equal, fail, integer} from '../host.js';
import {defaultStringOrdering} from '../globalization/string-ordering.js';

const owner = 'System.Array';

function contracts({define, member}) {
  define(owner, {kind: 'bcl14', family: 'array'});
  for (const element of ['int', 'double', 'bool', 'string', 'object']) {
    const arrayType = element + '[]';
    const members = [
      ['Copy', [arrayType, arrayType, 'int'], 'void'],
      ['Copy', [arrayType, 'int', arrayType, 'int', 'int'], 'void'],
      ['Clear', [arrayType, 'int', 'int'], 'void'],
      ['Fill', [arrayType, element], 'void'],
      ['Fill', [arrayType, element, 'int', 'int'], 'void'],
      ['IndexOf', [arrayType, element], 'int'],
      ['LastIndexOf', [arrayType, element], 'int'],
      ['BinarySearch', [arrayType, element], 'int']
    ];
    for (const [name, parameters, result] of members) {
      member(owner, name, parameters, result, {isStatic: true});
    }
  }
}

function write(p, reference, record, index, value) {
  const oldValue = record.data[index];
  record.data[index] = value;
  p.vm.notifyWrite({kind: 'array', handle: reference.h, generation: reference.g, index, value, oldValue});
}

function copy(p, source, args, native) {
  const indexed = args.length === 5;
  const sourceIndex = indexed ? native[1] : 0;
  const destinationIndex = indexed ? native[3] : 0;
  const count = indexed ? native[4] : native[2];
  const destinationReference = args[indexed ? 2 : 1];
  if (!destinationReference) fail(p, 'ArgumentNullException', 'Destination array is required');
  const destination = p.heap.get(destinationReference);
  if (destination.kind !== 'array' || destination.type !== source.type) {
    fail(p, 'ArrayTypeMismatchException', 'Array element types must agree');
  }
  integer(p, sourceIndex, 0, source.data.length);
  integer(p, destinationIndex, 0, destination.data.length);
  integer(p, count, 0, Math.min(source.data.length - sourceIndex, destination.data.length - destinationIndex));
  // Preserve overlapping copies in either direction and validate before the first write.
  const values = source.data.slice(sourceIndex, sourceIndex + count);
  for (let index = 0; index < count; index++) {
    write(p, destinationReference, destination, destinationIndex + index, values[index]);
  }
  return null;
}

function fill(p, source, args, native) {
  const start = args.length === 4 ? native[2] : 0;
  const count = args.length === 4 ? native[3] : source.data.length;
  integer(p, start, 0, source.data.length);
  integer(p, count, 0, source.data.length - start);
  for (let index = start; index < start + count; index++) {
    write(p, args[0], source, index, args[1]);
  }
  return null;
}

function clear(p, source, args, native) {
  const start = integer(p, native[1], 0, source.data.length);
  const count = integer(p, native[2], 0, source.data.length - start);
  const element = source.type.slice(0, -2);
  const value = ['int', 'double'].includes(element)
    ? p.managed(0, element)
    : element === 'bool' ? p.managed(false, 'bool') : null;
  for (let index = start; index < start + count; index++) {
    write(p, args[0], source, index, value);
  }
  return null;
}

function indexOf(p, source, args) {
  for (let index = 0; index < source.data.length; index++) {
    if (equal(p, source.data[index], args[1])) return index;
  }
  return -1;
}

function lastIndexOf(p, source, args) {
  for (let index = source.data.length - 1; index >= 0; index--) {
    if (equal(p, source.data[index], args[1])) return index;
  }
  return -1;
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function binarySearch(p, source, args, native) {
  if (args.length === 3) return searchWithComparer(p, source, args);
  if (isObject(native[1]) || source.data.some(value => isObject(p.native(value)))) {
    fail(p, 'InvalidOperationException', 'Binary search requires registered comparable primitive elements');
  }
  const value = native[1];
  return binarySearchIndices(source.data.length, index => {
    const current = p.native(source.data[index]);
    if (typeof current === 'string' && typeof value === 'string') return defaultStringOrdering(p).compare(current, value);
    if (equal(p, source.data[index], args[1])) return 0;
    const less = current === null || typeof current === 'number' && Number.isNaN(current)
      ? true
      : value === null || typeof value === 'number' && Number.isNaN(value) ? false : current < value;
    return less ? -1 : 1;
  });
}

const operations = Object.freeze({
  Copy: copy,
  Fill: fill,
  Clear: clear,
  IndexOf: indexOf,
  LastIndexOf: lastIndexOf,
  BinarySearch: binarySearch
});

function invoke(p, descriptor, args, type = p.bclHost.frameworkType(descriptor.owner)) {
  if (type?.kind !== 'bcl14' || type.family !== 'array') return {handled: false};
  const native = args.map(value => p.native(value));
  if (!args[0]) fail(p, 'ArgumentNullException', 'Source array is required');
  const source = p.heap.get(args[0]);
  if (source.kind !== 'array') fail(p, 'ArgumentException', 'Source must be an array');
  const operation = Object.hasOwn(operations, descriptor.name) ? operations[descriptor.name] : null;
  if (!operation) fail(p, 'MissingMethodException', descriptor.owner + '.' + descriptor.name);
  return {handled: true, value: operation(p, source, args, native)};
}

/** Released Array contracts and heap operations; range failures leave array contents unchanged. */
export const arrayModule = Object.freeze({name: 'array', families: ['array'], contracts, invoke});
