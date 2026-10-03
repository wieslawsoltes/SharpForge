import {arrayRuntimeDefinition} from '@sharpforge/cil';
import {ManagedFault, isReference} from '../heap.js';
import {arrayRecord, arrayShape, createArray, arrayGet, arraySet} from './arrays.js';
import {arrayInteger} from './array-limits.js';
import {storageRead, storageWrite, rawArrayBytes} from './array-storage.js';
import {copyValue, boxValue, unboxValue} from './value-types.js';
import {storageDefault} from './storage.js';
import {checkArrayStore} from './casting.js';
import {number} from './numeric-ops.js';

function writable(vm, reference) {
  return vm.heap.ensureWritable ? vm.heap.ensureWritable(reference) : vm.heap.get(reference).data;
}

function range(record, start, count) {
  const lower = arrayShape(record).lowerBounds[0];
  const offset = arrayInteger(start, 'ArgumentOutOfRangeException') - lower;
  const length = arrayInteger(count, 'ArgumentOutOfRangeException');
  if (offset < 0 || length < 0 || offset > record.data.length - length) {
    throw new ManagedFault('ArgumentException', 'Array range exceeds its bounds');
  }
  return {offset, length};
}

export function copyArray(vm, source, sourceIndex, destination, destinationIndex, length) {
  return vm.heap.withRoots([source, destination], () => {
    const from = arrayRecord(vm, source);
    const to = arrayRecord(vm, destination);
    if (arrayShape(from).rank !== arrayShape(to).rank) throw new ManagedFault('RankException', 'Array ranks differ');
    const input = range(from, sourceIndex, length);
    const output = range(to, destinationIndex, length);
    const sourceType = from.methodTable.elementType;
    const targetType = to.methodTable.elementType;
    const target = writable(vm, destination);
    if (sourceType === targetType && ArrayBuffer.isView(target)) {
      target.set(from.data.subarray(input.offset, input.offset + input.length), output.offset);
      return;
    }
    const backwards = source.h === destination.h && output.offset > input.offset;
    for (let step = 0; step < input.length; step++) {
      const index = backwards ? input.length - step - 1 : step;
      let value = storageRead(from.data, input.offset + index, sourceType, {source: !!vm.image && !vm.inspector});
      if (sourceType.flags.valueType && !targetType.flags.valueType) value = boxValue(vm, value, sourceType);
      else if (!sourceType.flags.valueType && targetType.flags.valueType) value = unboxValue(vm, value, targetType);
      else if (sourceType !== targetType && sourceType.flags.valueType && targetType.flags.valueType) {
        // Reflection conversion implements the CLI primitive widening matrix.
        const boxed = boxValue(vm, value, sourceType);
        const flat = output.offset + index;
        const indices = indicesForOffset(to, flat);
        arraySet(vm, destination, indices, boxed, {reflection: true});
        continue;
      }
      value = copyValue(vm, value, targetType);
      checkArrayStore(vm.heap, to, value);
      storageWrite(target, output.offset + index, value);
    }
  });
}

function indicesForOffset(record, offset) {
  const shape = arrayShape(record);
  return shape.strides.map((stride, index) => {
    const value = Math.floor(offset / stride);
    offset %= stride;
    return value + shape.lowerBounds[index];
  });
}

export function clearArray(vm, reference, start = null, length = null) {
  const record = arrayRecord(vm, reference);
  const lower = arrayShape(record).lowerBounds[0];
  const bounds = range(record, start ?? lower, length ?? record.data.length);
  const data = writable(vm, reference);
  const zero = storageDefault(vm, record.methodTable.elementType);
  for (let index = bounds.offset; index < bounds.offset + bounds.length; index++) storageWrite(data, index, zero);
}

export function cloneArray(vm, reference) {
  const record = arrayRecord(vm, reference);
  const shape = arrayShape(record);
  return vm.heap.withRoots([reference], () => {
    const clone = createArray(vm, record.methodTable.elementType, [...shape.lengths], [...shape.lowerBounds]);
    copyArray(vm, reference, shape.lowerBounds[0], clone, shape.lowerBounds[0], record.data.length);
    return clone;
  });
}

function equalValue(vm, left, right) {
  if (isReference(left) && isReference(right)) {
    const a = vm.heap.get(left);
    const b = vm.heap.get(right);
    if (a.kind === 'string' && b.kind === 'string') return a.data === b.data;
    if (a.kind === 'box' && b.kind === 'box') return a.methodTable === b.methodTable && equalValue(vm, a.data[0], b.data[0]);
    return left.h === right.h && left.g === right.g;
  }
  if (left?.valueType && right?.valueType) {
    return left.valueType === right.valueType && left.fields.every((value, index) => equalValue(vm, value, right.fields[index]));
  }
  const a = number(left);
  const b = number(right);
  return a === b || typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
}

export function indexOfArray(vm, reference, value, start = null, length = null, boxed = false) {
  const record = arrayRecord(vm, reference);
  const shape = arrayShape(record);
  if (shape.rank !== 1) throw new ManagedFault('RankException', 'IndexOf requires a vector');
  const lower = shape.lowerBounds[0];
  const first = start ?? lower;
  const bounds = range(record, first, length ?? record.data.length - (first - lower));
  const element = record.methodTable.elementType;
  if (boxed && element.flags.valueType) {
    if (value === null || !isReference(value) || vm.heap.get(value).methodTable !== element) return lower - 1;
    value = unboxValue(vm, value, element);
  }
  for (let index = bounds.offset; index < bounds.offset + bounds.length; index++) {
    if (equalValue(vm, storageRead(record.data, index, element), value)) return index + lower;
  }
  return lower - 1;
}

export function initializeArray(vm, reference, handle) {
  const record = arrayRecord(vm, reference);
  if (!Object.isFrozen(handle) || handle?.runtimeHandle !== 'field' || handle.owner !== vm.snapshotOwner) {
    throw new ManagedFault('ArgumentException', 'InitializeArray requires an owned field handle');
  }
  const field = vm.inspector.resolveToken(handle.token);
  const row = vm.inspector.metadata.rows[29]?.find(item => item[1] === (handle.token & 0xffffff));
  if (!field.isStatic || !row || !(field.flags & 0x100)) throw new ManagedFault('ArgumentException', 'Field has no RVA initializer');
  let bytes;
  try { bytes = rawArrayBytes(writable(vm, reference)); }
  catch { throw new ManagedFault('ArgumentException', 'InitializeArray requires primitive storage'); }
  const fieldType = vm.typeSystem.table(field.signature.type);
  const size = vm.inspector.metadata.rows[15]?.find(item => item[2] === (fieldType.definitionToken & 0xffffff))?.[1];
  if (size === undefined || bytes.length > size) throw new ManagedFault('ArgumentException', 'Field initializer is smaller than the array');
  const offset = vm.inspector.pe.offsetOf(row[0], size);
  bytes.set(vm.inspector.pe.bytes.subarray(offset, offset + bytes.length));
  return null;
}

export function arrayRuntimeCall(vm, descriptor, args) {
  const definition = arrayRuntimeDefinition(descriptor);
  if (!definition) return {handled: false};
  let value = null;
  switch (definition.operation) {
    case 'initialize': value = initializeArray(vm, args[0], args[1]); break;
    case 'clone': value = cloneArray(vm, args[0]); break;
    case 'clear': clearArray(vm, args[0], args[1] ?? null, args[2] ?? null); break;
    case 'copy':
      if (args.length === 3) {
        const from = arrayShape(arrayRecord(vm, args[0])).lowerBounds[0];
        const to = arrayShape(arrayRecord(vm, args[1])).lowerBounds[0];
        copyArray(vm, args[0], from, args[1], to, args[2]);
      } else copyArray(vm, args[0], args[1], args[2], args[3], args[4]);
      break;
    case 'indexOf': value = indexOfArray(vm, args[0], args[1], args[2] ?? null, args[3] ?? null, !definition.element); break;
    case 'resize': {
      const previous = vm.dereference(args[0]);
      const length = arrayInteger(args[1], 'ArgumentOutOfRangeException');
      if (length < 0) throw new ManagedFault('ArgumentOutOfRangeException', 'Resize length is negative');
      const replacement = vm.heap.withRoots([previous, args[0]], () => createArray(vm, definition.element, [length]));
      if (previous !== null) copyArray(vm, previous, 0, replacement, 0, Math.min(length, arrayRecord(vm, previous).data.length));
      vm.dereference(args[0], true, replacement);
      break;
    }
  }
  return {handled: true, returns: descriptor.signature.returnType !== 'void', value};
}
