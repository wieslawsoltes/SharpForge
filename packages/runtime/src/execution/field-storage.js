import {scalarStorageGuard} from './scalar-storage-plan.js';

/** Reuse canonical scalars after field resolution validates the receiver and closes its signature. */
export function loadFieldValue(vm, field, value) {
  const type = field.signature.type;
  if (vm.options.scalarFieldLoads !== false) {
    const accepts = scalarStorageGuard(type);
    if (accepts && accepts(value, vm.options)) return value;
  }
  return vm.storage(value, type);
}
