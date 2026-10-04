import {numericPlanTypes} from './numeric-specialization.js';
import {typedFloatHandler} from './typed-float-handlers.js';

/** Bounded, optional contribution to the existing decode-plan handler array. */
export function specializeFloatPlan(vm, method, offsets, handlers) {
  if (vm.options.typedNumericStack !== true) return;
  const states = numericPlanTypes(vm, method, offsets);
  if (!states) return;
  for (let index = 0; index < handlers.length; index++) {
    handlers[index] = typedFloatHandler(method, method.instructions[index], states[index], handlers[index]) ?? handlers[index];
  }
}

/** Body/signature replacements and option changes cannot retain stale numeric facts. */
export function floatPlanCurrent(vm, method, entry) {
  return entry.typed === (vm.options.typedNumericStack === true) && (!entry.typed ||
    entry.report === vm.report && entry.handlers === method.handlers && entry.capacity === method.maxStack &&
    entry.signature === method.signature && entry.parameters === method.signature.parameters && entry.locals === method.locals);
}

export function floatPlanIdentity(vm, method) {
  return {typed: vm.options.typedNumericStack === true, report: vm.report, handlers: method.handlers,
    capacity: method.maxStack, signature: method.signature, parameters: method.signature.parameters, locals: method.locals};
}
