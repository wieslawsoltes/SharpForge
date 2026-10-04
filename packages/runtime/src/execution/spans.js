import {ManagedFault} from '../heap.js';
import {arrayInteger} from './array-limits.js';
import {arrayRecord, arrayAddress, arrayGet, arraySet, createArray} from './arrays.js';
import {stackAllocate} from './stack-memory.js';
import {pointerOffset, rawMemoryView, readMemory, writeMemory} from './raw-memory.js';
import {valueLayout} from './value-layout.js';
import {castCacheFor} from './casting.js';
import {createManagedAddress} from './managed-address.js';
import {validateSpan} from './span-validation.js';
import {stringSpanLocation, stringSpanPointer, stringSpanValue} from './string-span.js';
export {validateSpan} from './span-validation.js';
export {spanFromString} from './string-span.js';

function fail(message) {
  throw new ManagedFault('ArgumentOutOfRangeException', message);
}

/** A ref struct carries an owned location and length, never a host array alias. */
export function spanCreate(vm, elementType, pointer, length, {readonly = false} = {}) {
  const element = vm.heap.methodTables.get(elementType);
  const count = arrayInteger(length, 'ArgumentOutOfRangeException');
  if (count < 0) fail('Span length cannot be negative');
  if (pointer === null && count !== 0) fail('A nonempty span requires storage');
  if (pointer?.readonly && !readonly) {
    throw new ManagedFault('InvalidProgramException', 'A readonly address cannot create a mutable Span');
  }
  if (pointer !== null && (!pointer?.byref || !Object.isFrozen(pointer) ||
      !Array.isArray(pointer.path) || !Object.isFrozen(pointer.path))) {
    throw new ManagedFault('InvalidProgramException', 'Span requires an immutable owned address');
  }
  if (pointer?.memoryPointer) {
    const layout = valueLayout(vm, element);
    if (layout.containsReferences) throw new ManagedFault('ArgumentException', 'Pointer-backed Span elements must be unmanaged');
    rawMemoryView(vm, pointer, count * layout.size);
  }
  else if (pointer?.kind === 'string') {
    const record = stringSpanLocation(vm, pointer, true);
    if (!readonly || element !== vm.heap.methodTables.get('char') || pointer.index > record.data.length - count) {
      throw new ManagedFault('InvalidProgramException', 'String-backed spans require readonly character storage');
    }
  } else if (pointer !== null) {
    if (pointer?.kind !== 'array' || pointer.path?.length || pointer.vmOwner !== vm.snapshotOwner) {
      throw new ManagedFault('InvalidProgramException', 'Span requires an owned array or stack address');
    }
    const record = arrayRecord(vm, pointer.owner);
    const actual = record.methodTable.elementType;
    const compatible = actual === element || readonly && !actual.flags.valueType && !element.flags.valueType &&
      castCacheFor(vm.heap.methodTables).isAssignableFrom(element, actual);
    if (!compatible || !Number.isSafeInteger(pointer.index) || pointer.index < 0 || pointer.index > record.data.length - count) {
      throw new ManagedFault('ArrayTypeMismatchException', 'Span element storage is incompatible');
    }
  }
  return Object.freeze({span: true, vmOwner: vm.snapshotOwner, elementType: element, pointer, length: count, readonly: !!readonly});
}

export function stackSpan(vm, type, length) {
  const count = arrayInteger(length, 'OverflowException');
  if (count < 0) throw new ManagedFault('OverflowException', 'Stack allocation length cannot be negative');
  const table = vm.heap.methodTables.get(type);
  const layout = valueLayout(vm, table);
  if (layout.containsReferences) throw new ManagedFault('NotSupportedException', 'Stackalloc element must be unmanaged');
  return spanCreate(vm, table, stackAllocate(vm, count * layout.size), count);
}

export function spanFromArray(vm, element, reference, start = 0, length = null, options = {}) {
  if (reference === null) {
    if (arrayInteger(start, 'ArgumentOutOfRangeException') !== 0) fail('Null array Span start must be zero');
    return spanCreate(vm, element, null, length ?? 0, options);
  }
  const record = arrayRecord(vm, reference);
  const index = arrayInteger(start, 'ArgumentOutOfRangeException');
  const count = length === null ? record.data.length - index : arrayInteger(length, 'ArgumentOutOfRangeException');
  if (index < 0 || count < 0 || index > record.data.length - count) fail('Span bounds exceed the array');
  const requested = vm.heap.methodTables.get(element);
  const actual = record.methodTable.elementType;
  const compatible = actual === requested || options.readonly && !actual.flags.valueType && !requested.flags.valueType &&
    castCacheFor(vm.heap.methodTables).isAssignableFrom(requested, actual);
  if (!record.methodTable.flags.szArray || !compatible) {
    throw new ManagedFault('ArrayTypeMismatchException', 'Span requires a compatible vector');
  }
  const pointer = count === 0 ? createManagedAddress(vm, 'array', index, reference, options)
    : arrayAddress(vm, reference, [index], {type: element, readonly: !!options.readonly});
  return spanCreate(vm, element, pointer, count, options);
}


export function spanLength(vm, value) {
  return validateSpan(vm, value).length;
}

export function spanAddress(vm, value, index) {
  validateSpan(vm, value);
  const offset = arrayInteger(index);
  if (offset < 0 || offset >= value.length) throw new ManagedFault('IndexOutOfRangeException', 'Span index is outside its bounds');
  if (value.pointer.memoryPointer) {
    const pointer = pointerOffset(vm, value.pointer, offset * valueLayout(vm, value.elementType).size, value.elementType);
    return Object.freeze({...pointer, readonly: value.readonly || pointer.readonly});
  }
  if (value.pointer.kind === 'string') return stringSpanPointer(vm, value.pointer.owner, value.pointer.index + offset);
  return arrayAddress(vm, value.pointer.owner, [value.pointer.index + offset], {type: value.elementType, readonly: value.readonly});
}

export function spanGet(vm, value, index) {
  const pointer = spanAddress(vm, value, index);
  return pointer.memoryPointer ? readMemory(vm, pointer) : pointer.kind === 'string'
    ? stringSpanValue(vm, pointer) : arrayGet(vm, pointer.owner, [pointer.index]);
}

export function spanSet(vm, value, index, replacement) {
  const pointer = spanAddress(vm, value, index);
  if (value.readonly) throw new ManagedFault('InvalidProgramException', 'Cannot write a ReadOnlySpan');
  return pointer.memoryPointer ? writeMemory(vm, pointer, replacement) : arraySet(vm, pointer.owner, [pointer.index], replacement);
}

export function spanSlice(vm, value, start, length = null) {
  validateSpan(vm, value);
  const index = arrayInteger(start, 'ArgumentOutOfRangeException');
  const count = length === null ? value.length - index : arrayInteger(length, 'ArgumentOutOfRangeException');
  if (index < 0 || count < 0 || index > value.length - count) fail('Slice is outside the span');
  const pointer = count ? spanAddress(vm, value, index) : value.pointer?.memoryPointer
    ? pointerOffset(vm, value.pointer, index * valueLayout(vm, value.elementType).size, value.elementType)
    : value.pointer?.kind === 'string' ? stringSpanPointer(vm, value.pointer.owner, value.pointer.index + index)
      : value.pointer ? createManagedAddress(vm, 'array', value.pointer.index + index, value.pointer.owner, {readonly: value.readonly}) : null;
  return spanCreate(vm, value.elementType, pointer, count, {readonly: value.readonly});
}

export function spanToArray(vm, value) {
  validateSpan(vm, value);
  return vm.heap.withRoots([value], () => {
    const array = createArray(vm, value.elementType, [value.length]);
    return vm.heap.withRoots([array], () => {
      for (let index = 0; index < value.length; index++) arraySet(vm, array, [index], spanGet(vm, value, index));
      return array;
    });
  });
}
