import {selectedCallOwner} from './generic-calls.js';

/** An Object override executes in its receiver's exact closed declaring instance. */
export function objectCallOwner(vm, target, type, reference) {
  if (!vm.inspector) return null;
  if (type.flags.valueType) return type.typeArguments.length ? type.name : null;
  return selectedCallOwner(vm, target, reference, null);
}
