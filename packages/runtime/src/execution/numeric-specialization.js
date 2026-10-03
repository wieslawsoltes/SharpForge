import {numericStackTypes} from './numeric-stack-types.js';
import {specializedNumericHandler} from './specialized-numeric-handlers.js';

/** Contribution to getDecodePlan: called once before its arrays and record are frozen. */
export function specializeNumericHandlers(vm, method, plan) {
  if (vm.options.specializeNumericHandlers === false) return plan;
  const states = numericStackTypes(vm.inspector, method, plan.offsets);
  const ids = Array(method.instructions.length).fill(null);
  for (let index = 0; index < method.instructions.length; index++) {
    const selected = specializedNumericHandler(method.instructions[index].name, states[index]);
    if (!selected) continue;
    plan.handlers[index] = selected.handler;
    ids[index] = selected.id;
  }
  plan.numericHandlerIds = Object.freeze(ids);
  plan.numericStackStates = Object.freeze(states);
  return plan;
}
