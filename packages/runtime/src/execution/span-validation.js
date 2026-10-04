import {ManagedFault} from '../heap.js';
import {validateMemoryPointer, rawMemoryView} from './raw-memory.js';
import {valueLayout} from './value-layout.js';
import {castCacheFor} from './casting.js';
import {stringSpanLocation} from './string-span.js';

/** Validate lifetime, element identity and complete bounds without exposing mutable storage. */
export function validateSpan(vm, value) {
  if (!value?.span || !Object.isFrozen(value) || value.vmOwner !== vm.snapshotOwner ||
      value.elementType?.registry !== vm.heap.methodTables || !Number.isSafeInteger(value.length) || value.length < 0 ||
      typeof value.readonly !== 'boolean' || value.pointer === null && value.length !== 0 ||
      value.pointer?.readonly && !value.readonly) {
    throw new ManagedFault('InvalidProgramException', 'Malformed or foreign Span');
  }
  if (value.pointer?.memoryPointer) {
    if (valueLayout(vm, value.elementType).containsReferences) {
      throw new ManagedFault('InvalidProgramException', 'Pointer-backed Span contains managed references');
    }
    validateMemoryPointer(vm, value.pointer);
    rawMemoryView(vm, value.pointer, value.length * valueLayout(vm, value.elementType).size);
  } else if (value.pointer?.kind === 'string') {
    const record = stringSpanLocation(vm, value.pointer, true);
    if (!value.readonly || value.elementType !== vm.heap.methodTables.get('char') ||
        value.pointer.index > record.data.length - value.length) {
      throw new ManagedFault('InvalidProgramException', 'Malformed string-backed Span');
    }
  } else if (value.pointer) {
    const pointer = value.pointer;
    const record = vm.heap.get(pointer.owner);
    if (record.kind !== 'array') throw new ManagedFault('InvalidProgramException', 'Span requires array storage');
    const actual = record.methodTable.elementType;
    const compatible = actual === value.elementType || value.readonly && !actual.flags.valueType && !value.elementType.flags.valueType &&
      castCacheFor(vm.heap.methodTables).isAssignableFrom(value.elementType, actual);
    if (!pointer.byref || !Object.isFrozen(pointer) || pointer.vmOwner !== vm.snapshotOwner || pointer.kind !== 'array' ||
        !Array.isArray(pointer.path) || !Object.isFrozen(pointer.path) || pointer.path.length || !compatible ||
        !Number.isSafeInteger(pointer.index) || pointer.index < 0 ||
        pointer.index > record.data.length - value.length) {
      throw new ManagedFault('InvalidProgramException', 'Malformed Span array region');
    }
  }
  return value;
}
