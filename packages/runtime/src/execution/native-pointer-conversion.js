import {ManagedFault} from '../heap.js';
import {pinnedAddress} from './pinned.js';
import {inspectManagedAddress} from './managed-address.js';
import {inspectSourceAddress} from './source-addresses.js';
import {reinterpretPointer, pointerOffset, validateMemoryPointer} from './raw-memory.js';

/** Native conversion retains an existing capability, a lexical array pin, or an unmanaged frame slot. */
export function nativePointerConversion(vm, value, elementType = null) {
  if (value?.memoryPointer) {
    validateMemoryPointer(vm, value);
    return elementType ? pointerOffset(vm, value, 0, elementType) : value;
  }
  if (value?.kind === 'array') {
    const pointer = pinnedAddress(vm, value);
    return elementType ? pointerOffset(vm, pointer, 0, elementType) : pointer;
  }
  if (!value?.byref || !['local', 'arg'].includes(value.kind)) {
    throw new ManagedFault('InvalidProgramException', 'Native pointer conversion requires a frame slot or a live array pin');
  }
  const location = vm.inspector ? inspectManagedAddress(vm, value) : inspectSourceAddress(vm, value);
  return reinterpretPointer(vm, value, location.type, elementType ?? location.type);
}
