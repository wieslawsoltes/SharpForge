import {reusableScalarType} from './scalar-storage-plan.js';

// A resolved signature includes generic substitutions and stripped modifiers.
// Cache metadata only: field values, instances and VMs never enter this cache.
const plans = new WeakMap();

function reusable(signature) {
  let plan = plans.get(signature);
  if (!plan || plan.type !== signature.type) {
    plan = {type: signature.type, reusable: reusableScalarType(signature.type)};
    plans.set(signature, plan);
  }
  return plan.reusable;
}

/**
 * Reuse normalized scalar fields on load. Initialization and every field write
 * enforce their storage type; reference, enum, pointer and aggregate reads keep
 * the original adapter. Undefined values retain its existing fault behavior.
 * `scalarFieldLoads:false` restores normalization for differential measurement.
 */
export function loadField(vm, value, field) {
  if (vm.options.scalarFieldLoads !== false && value !== undefined && reusable(field.signature)) return value;
  return vm.storage(value, field.signature.type);
}
