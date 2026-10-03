import {ManagedFault} from '../heap.js';
import {arrayInteger} from './array-limits.js';
import {arrayRecord, arrayAddress, arrayGet, arraySet, createArray} from './arrays.js';
import {stackAllocate} from './stack-memory.js';
import {pointerOffset, rawMemoryView, readMemory, writeMemory, validateMemoryPointer} from './raw-memory.js';
import {valueLayout} from './value-layout.js';

function fail(message) {
  throw new ManagedFault('ArgumentOutOfRangeException', message);
}

/** A ref struct carries an owned location and length, never a host array alias. */
export function spanCreate(vm, elementType, pointer, length, {readonly = false} = {}) {
  const element = vm.heap.methodTables.get(elementType);
  const count = arrayInteger(length, 'ArgumentOutOfRangeException');
  if (count < 0) fail('Span length cannot be negative');
  if (pointer === null && count !== 0) fail('A nonempty span requires storage');
  if (pointer?.memoryPointer) rawMemoryView(vm, pointer, count * valueLayout(vm, element).size);
  else if (pointer !== null) {
    if (pointer?.kind !== 'array' || pointer.path?.length || pointer.vmOwner !== vm.snapshotOwner) {
      throw new ManagedFault('InvalidProgramException', 'Span requires an owned array or stack address');
    }
    const record = arrayRecord(vm, pointer.owner);
    if (record.methodTable.elementType !== element || pointer.index + count > record.data.length) {
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
  if (reference === null) return spanCreate(vm, element, null, length ?? 0, options);
  const record = arrayRecord(vm, reference);
  const index = arrayInteger(start, 'ArgumentOutOfRangeException');
  const count = length === null ? record.data.length - index : arrayInteger(length, 'ArgumentOutOfRangeException');
  if (index < 0 || count < 0 || index > record.data.length - count) fail('Span bounds exceed the array');
  if (count === 0) return spanCreate(vm, element, null, 0, options);
  return spanCreate(vm, element, arrayAddress(vm, reference, [index], {type: element}), count, options);
}

export function validateSpan(vm, value) {
  if (!value?.span || !Object.isFrozen(value) || value.vmOwner !== vm.snapshotOwner || value.elementType.registry !== vm.heap.methodTables) {
    throw new ManagedFault('InvalidProgramException', 'Malformed or foreign Span');
  }
  if (value.pointer?.memoryPointer) validateMemoryPointer(vm, value.pointer);
  else if (value.pointer) vm.heap.get(value.pointer.owner);
  return value;
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
  return arrayAddress(vm, value.pointer.owner, [value.pointer.index + offset], {type: value.elementType, readonly: value.readonly});
}

export function spanGet(vm, value, index) {
  const pointer = spanAddress(vm, value, index);
  return pointer.memoryPointer ? readMemory(vm, pointer) : arrayGet(vm, pointer.owner, [pointer.index]);
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
  const pointer = count ? spanAddress(vm, value, index) : null;
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
