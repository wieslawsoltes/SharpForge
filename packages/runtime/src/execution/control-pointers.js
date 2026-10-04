import {
  ManagedFault
} from '../heap.js';
import {
  createManagedAddress,
  inspectManagedAddress
} from './managed-address.js';
import {
  sourceAddress,
  inspectSourceAddress
} from './source-addresses.js';

/** Thin control-runtime adapter over the canonical source and CIL location ABIs. */
export function address(vm, kind, index, owner = null, options = {}) {
  return vm.inspector ? createManagedAddress(vm, kind, index, owner, options) : sourceAddress(vm, kind, index, owner, options);
}

export function validatePointer(vm, pointer, {
  write = false
} = {}) {
  const location = vm.inspector ? inspectManagedAddress(vm, pointer) : inspectSourceAddress(vm, pointer);
  if (write && location.readonly) throw new ManagedFault('InvalidProgramException', 'Cannot write through a readonly managed address');
  return location;
}

export function pointerType(vm, pointer) {
  const type = validatePointer(vm, pointer).type;
  return vm.inspector ? vm.typeSystem.table(type) : vm.heap.methodTables.get(type);
}
