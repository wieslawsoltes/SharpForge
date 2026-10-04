import {verifiedStackBound} from '@sharpforge/cil';
import {executionCodeState} from './code-version.js';
import {numericStackTypes} from './numeric-stack-types.js';
import {specializedInt32Handler} from './handlers/arith-specialized.js';
import {specializedInt64Handler} from './handlers/int64-specialized.js';

const analyses = new WeakMap();

function identity(vm, method) {
  return {report: vm.report, instructions: method.instructions, handlers: method.handlers,
    capacity: method.maxStack, signature: method.signature, parameters: method.signature.parameters, locals: method.locals};
}

function current(vm, method, entry) {
  return entry?.report === vm.report && entry.instructions === method.instructions && entry.handlers === method.handlers &&
    entry.capacity === method.maxStack && entry.signature === method.signature &&
    entry.parameters === method.signature.parameters && entry.locals === method.locals;
}

/** One bounded proof/category analysis shared by opt-in numeric decode contributions in a code epoch. */
export function numericPlanTypes(vm, method, offsets) {
  const epoch = executionCodeState(vm);
  let cache = analyses.get(epoch);
  if (!cache) analyses.set(epoch, cache = new WeakMap());
  const previous = cache.get(method);
  if (current(vm, method, previous) && previous.offsets === offsets) return previous.states;
  let states = null;
  if (verifiedStackBound(vm.inspector, vm.report, method)) {
    try { states = Object.freeze(numericStackTypes(vm.inspector, method, offsets, 250_000)); }
    catch { /* Optional analysis exhaustion or unknown metadata retains ordinary execution. */ }
  }
  cache.set(method, {...identity(vm, method), offsets, states});
  return states;
}

/** Mutate the existing decode-plan handler array before it is frozen; no analysis when disabled. */
export function specializeNumericPlan(vm, method, offsets, handlers) {
  if (vm.options.specializeNumericHandlers !== true) return null;
  const states = numericPlanTypes(vm, method, offsets);
  if (!states) return null;
  const ids = Array(handlers.length).fill(null);
  for (let index = 0; index < handlers.length; index++) {
    const name = method.instructions[index].name;
    const selected = specializedInt32Handler(name, states[index], handlers[index]) ??
      specializedInt64Handler(name, states[index], handlers[index]);
    if (!selected) continue;
    handlers[index] = selected.handler;
    ids[index] = selected.id;
  }
  return Object.freeze(ids);
}

/** Separate option key permits other decode contributions to keep their own opt-in switch. */
export function numericPlanCurrent(vm, method, entry) {
  return entry.numericEnabled === (vm.options.specializeNumericHandlers === true) &&
    (!entry.numericEnabled || current(vm, method, entry.numericIdentity));
}

export function numericPlanIdentity(vm, method) {
  const numericEnabled = vm.options.specializeNumericHandlers === true;
  return {numericEnabled, numericIdentity: numericEnabled ? identity(vm, method) : null};
}
