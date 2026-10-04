import {ManagedFault} from '../heap.js';
import {reusableScalarType} from './scalar-storage-plan.js';

// Plans contain metadata only. A closed generic method has its own signature and
// locals, so its classification never leaks into another instantiation or VM.
const plans = new WeakMap();

function planFor(method) {
  let entry = plans.get(method);
  const signature = method.signature;
  if (entry?.locals === method.locals && entry.parameters === signature.parameters && entry.isStatic === signature.isStatic) {
    return entry;
  }
  entry = {
    locals: method.locals,
    parameters: signature.parameters,
    isStatic: signature.isStatic,
    localLoads: method.locals.map(reusableScalarType),
    argumentLoads: [...(signature.isStatic ? [] : [false]), ...signature.parameters.map(reusableScalarType)],
  };
  plans.set(method, entry);
  return entry;
}

/**
 * Loads a verified CLI slot. Stores, call entry and initialization already enforce
 * its scalar storage type. Immutable scalar payloads can therefore be shared on
 * reads; structs, references and managed pointers keep their existing adapters.
 * `scalarSlotLoads:false` selects the generic path for differential measurement.
 */
export function loadSlot(vm, frame, argument, index) {
  const value = (argument ? frame.args : frame.locals)[index];
  if (value === undefined) throw new ManagedFault('InvalidProgramException', 'Read of uninitialized local');
  if (vm.options.scalarSlotLoads !== false) {
    const plan = planFor(frame.method);
    if ((argument ? plan.argumentLoads : plan.localLoads)[index]) return value;
  }
  return vm.storage(value, vm.slotType(frame, argument, index));
}
