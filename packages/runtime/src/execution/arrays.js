import {ManagedFault} from '../heap.js';
import {number} from './numeric-ops.js';
import {storageDefault, storageValue} from './storage.js';
import {boxValue} from './boxing.js';
import {createManagedAddress} from './managed-address.js';
import {checkArrayStore, castCacheFor} from './casting.js';
import {enumValue} from './enums.js';
import {arrayInteger, reserveArray} from './array-limits.js';
import {isArrayStorage, primitiveArrayStorage, storageRead, storageWrite} from './array-storage.js';
import {reflectedArrayValue} from './array-reflection.js';

const fault = (name, message) => new ManagedFault(name, message);

/** Validate the object header before interpreting any array payload. */
export function arrayRecord(vm, reference) {
  const record = vm.heap.get(reference);
  if (record.kind !== 'array' || !record.methodTable.flags.array) {
    throw fault('InvalidProgramException', 'An array reference is required');
  }
  return record;
}

/** Existing vectors acquire immutable shape metadata lazily, once per record. */
export function arrayShape(record) {
  if (record.arrayShape) return record.arrayShape;
  if (!record.methodTable.flags.szArray) throw fault('InvalidProgramException', 'Multidimensional array shape is missing');
  return record.arrayShape = Object.freeze({rank: 1, szArray: true, lengths: Object.freeze([record.data.length]),
    lowerBounds: Object.freeze([0]), strides: Object.freeze([1])});
}

/** Snapshot preflight requires an exact, rank-bounded row-major storage description. */
export function validateArrayShape(record) {
  const invalid = () => { throw new TypeError('Invalid snapshot array shape'); };
  const table = record?.methodTable, shape = record?.arrayShape;
  if (!table?.flags.array || !isArrayStorage(record.data)) invalid();
  if (shape === undefined) {
    if (!table.flags.szArray) invalid();
    return;
  }
  if (!shape || !Number.isInteger(shape.rank) || shape.rank < 1 || shape.rank > 32 || shape.rank !== table.rank ||
      shape.szArray !== table.flags.szArray || ![shape.lengths, shape.lowerBounds, shape.strides]
        .every(values => Array.isArray(values) && values.length === shape.rank)) invalid();
  let total = 1;
  for (let index = shape.rank - 1; index >= 0; index--) {
    const length = shape.lengths[index], lower = shape.lowerBounds[index];
    if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(lower) ||
        length > 0 && !Number.isSafeInteger(lower + length - 1) || shape.strides[index] !== total) invalid();
    total *= length;
    if (!Number.isSafeInteger(total)) invalid();
  }
  if (total !== record.data.length || shape.szArray && (shape.rank !== 1 || shape.lowerBounds[0] !== 0)) invalid();
}

export function arrayVectorRecord(vm, reference, index) {
  const record = arrayRecord(vm, reference);
  if (!record.methodTable.flags.szArray) throw fault('InvalidProgramException', 'Vector opcode requires a zero-based vector');
  const offset = arrayInteger(index);
  if (offset < 0 || offset >= record.data.length) throw fault('IndexOutOfRangeException', 'Array index is outside its bounds');
  return record;
}

/** ECMA-335 II.14.2 row-major storage: the final dimension changes fastest. */
export function createArray(vm, elementType, lengths, lowerBounds = null, {reflection = false} = {}) {
  if (!Array.isArray(lengths) || lengths.length === 0) throw fault('ArgumentException', 'At least one dimension is required');
  if (lengths.length > 32) throw fault('TypeLoadException', 'Array rank exceeds the CLI limit of 32');
  if (lowerBounds !== null && (!Array.isArray(lowerBounds) || lowerBounds.length !== lengths.length)) {
    throw fault('ArgumentException', 'Array lengths and lower bounds have different ranks');
  }
  const element = vm.inspector ? vm.typeSystem.table(elementType) : vm.heap.methodTables.get(elementType);
  if (element.name === 'System.Void' || element.flags.byRef || element.flags.pointer || element.flags.refStruct ||
      element.containsGenericParameters) throw fault('NotSupportedException', 'Array element type cannot be instantiated');
  const sizes = lengths.map(value => arrayInteger(value, reflection ? 'ArgumentOutOfRangeException' : 'OverflowException'));
  const bounds = (lowerBounds ?? Array(sizes.length).fill(0)).map(value => arrayInteger(value, 'ArgumentOutOfRangeException'));
  let total = 1;
  for (let index = 0; index < sizes.length; index++) {
    if (sizes[index] < 0) throw fault(reflection ? 'ArgumentOutOfRangeException' : 'OverflowException', 'Negative array length');
    if (bounds[index] < -2147483648 || bounds[index] > 2147483647 ||
        sizes[index] > 0 && bounds[index] + sizes[index] - 1 > 2147483647) {
      throw fault('ArgumentOutOfRangeException', 'Array dimension exceeds Int32 bounds');
    }
    total *= sizes[index];
    if (!Number.isSafeInteger(total) || total > 0xffffffff) throw fault('OutOfMemoryException', 'Array dimensions exceed host addressing');
  }
  reserveArray(vm, element, total);
  const strides = Array(sizes.length);
  let stride = 1;
  for (let index = sizes.length - 1; index >= 0; index--) {
    strides[index] = stride;
    stride *= sizes[index];
  }
  // CoreCLR morphs rank-one ARRAY constructors with a zero lower bound to SZARRAY.
  const szArray = sizes.length === 1 && bounds[0] === 0;
  const suffix = szArray ? '[]' : sizes.length === 1 ? '[*]' : '[' + ','.repeat(sizes.length - 1) + ']';
  const table = vm.heap.methodTables.get(element.name + suffix);
  const data = primitiveArrayStorage(element, total, storageDefault(vm, element));
  const reference = vm.heap.allocate('array', table, data);
  vm.heap.get(reference).arrayShape = Object.freeze({rank: sizes.length, szArray, lengths: Object.freeze(sizes),
    lowerBounds: Object.freeze(bounds), strides: Object.freeze(strides)});
  return reference;
}

export function arrayOffset(record, indices, {reflection = false} = {}) {
  const shape = arrayShape(record);
  if (!Array.isArray(indices) || indices.length !== shape.rank) {
    throw fault(reflection ? 'ArgumentException' : 'InvalidProgramException', 'Index count must match array rank');
  }
  let offset = 0;
  for (let dimension = 0; dimension < indices.length; dimension++) {
    const error = reflection && typeof number(indices[dimension]) === 'bigint' ? 'ArgumentOutOfRangeException' : 'IndexOutOfRangeException';
    const index = arrayInteger(indices[dimension], error) - shape.lowerBounds[dimension];
    if (index < 0 || index >= shape.lengths[dimension]) throw fault('IndexOutOfRangeException', 'Array dimension index is out of bounds');
    offset += index * shape.strides[dimension];
  }
  return offset;
}

export function arrayDimension(vm, reference, dimension, property = 'length') {
  const shape = arrayShape(arrayRecord(vm, reference)), index = arrayInteger(dimension);
  if (index < 0 || index >= shape.rank) throw fault('IndexOutOfRangeException', 'Array dimension is outside its rank');
  if (property === 'lower') return shape.lowerBounds[index];
  if (property === 'upper') return shape.lowerBounds[index] + shape.lengths[index] - 1;
  return shape.lengths[index];
}

export function arrayGet(vm, reference, indices, {reflection = false, type = null} = {}) {
  return vm.heap.withRoots([reference], () => {
    const record = arrayRecord(vm, reference), offset = arrayOffset(record, indices, {reflection}), element = record.methodTable.elementType;
    const loaded = storageRead(record.data, offset, element, {source: !vm.inspector});
    const value = !vm.inspector && element.flags.enum ? enumValue(vm, element.name, loaded) : storageValue(vm, loaded, type ?? element);
    if (reflection && element.flags.valueType) return boxValue(vm, value, element);
    return !vm.inspector && element.name === 'System.Boolean' ? !!value : value;
  });
}

export function arrayAddress(vm, reference, indices, {type = null, readonly = false} = {}) {
  const record = arrayRecord(vm, reference), index = arrayOffset(record, indices), actual = record.methodTable.elementType;
  const requested = type === null ? actual : vm.inspector ? vm.typeSystem.table(type) : vm.heap.methodTables.get(type);
  const casts = castCacheFor(vm.heap.methodTables);
  const reducedAlias = requested.flags.valueType && actual.flags.valueType && casts.isAssignableFrom(
    vm.heap.methodTables.get(requested.name + '[]'), vm.heap.methodTables.get(actual.name + '[]'));
  if (requested !== actual && !reducedAlias && !(readonly && casts.isAssignableFrom(requested, actual))) {
    throw fault('ArrayTypeMismatchException', 'Array address requires a compatible element type');
  }
  return createManagedAddress(vm, 'array', index, reference, {readonly});
}

export function arraySet(vm, reference, indices, value, {reflection = false} = {}) {
  return vm.heap.withRoots([reference, value], () => {
    const record = arrayRecord(vm, reference), offset = arrayOffset(record, indices, {reflection}), element = record.methodTable.elementType;
    const stored = reflection ? reflectedArrayValue(vm, value, element) : storageValue(vm, value, element);
    if (!reflection) checkArrayStore(vm.heap, record, stored);
    const data = vm.heap.ensureWritable(reference).data;
    const oldValue = storageRead(data, offset, element, {source: !vm.inspector});
    storageWrite(data, offset, stored);
    const write = {kind: 'array', handle: reference.h, generation: reference.g, index: offset, value: stored, oldValue};
    if (vm.notifyWrite) vm.notifyWrite(write);
    else {
      vm.writeRevision++;
      vm.heap.mutationRevision++;
      vm.onWrite?.(write);
    }
    return stored;
  });
}

export const sourceArrayCreate = createArray;
export const sourceArrayGet = arrayGet;
export const sourceArraySet = arraySet;
export const sourceArrayAddress = arrayAddress;
