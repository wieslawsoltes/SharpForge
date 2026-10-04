import {ManagedFault} from '../heap.js';
import {scalarStorageGuard} from './scalar-storage-plan.js';
import {isFrameworkValueType} from './framework-values.js';

// Metadata only; no VM, frame, values or type-registry identities are retained.
const plans = new WeakMap();
function guardFor(method, argument, index, type) {
  let plan = plans.get(method);
  if (!plan) {
    plan = {locals: [], arguments: []};
    plans.set(method, plan);
  }
  const slots = argument ? plan.arguments : plan.locals;
  let entry = slots[index];
  // Check the live declared type, including closed signatures or metadata edits.
  if (!entry || entry.type !== type) {
    entry = {type, accepts: scalarStorageGuard(type)};
    slots[index] = entry;
  }
  return entry.accepts;
}

/** Reuse canonical immutable scalars; unusual or externally edited slots keep the storage adapter. */
export function loadSlot(vm, frame, argument, index) {
  const value = (argument ? frame.args : frame.locals)[index];
  if (value === undefined) throw new ManagedFault('InvalidProgramException', 'Read of uninitialized local');
  const type = vm.slotType(frame, argument, index);
  // The registered value ABI borrows its carrier for instance access; assignments own copies in storageValue.
  if (isFrameworkValueType(type, vm.heap.methodTables)) return value;
  if (vm.options.scalarSlotLoads !== false) {
    const accepts = guardFor(frame.method, argument, index, type);
    if (accepts && accepts(value, vm.options)) return value;
  }
  return vm.storage(value, type);
}
