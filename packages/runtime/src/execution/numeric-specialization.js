import {numericStackTypes} from './numeric-stack-types.js';
import {specializedNumericHandler} from './specialized-numeric-handlers.js';
import {typedFloatHandler} from './typed-float-handlers.js';
import {typedSlotHandler} from './typed-slot-handlers.js';
import {smallLongHandler} from './small-long-handlers.js';

/** Contribution to getDecodePlan: called once before its arrays and record are frozen. */
export function specializeNumericHandlers(vm, method, plan) {
  if (vm.options.specializeNumericHandlers === false) return plan;
  const states = numericStackTypes(vm.inspector, method, plan.offsets);
  const ids = Array(method.instructions.length).fill(null);
  for (let index = 0; index < method.instructions.length; index++) {
    const instruction = method.instructions[index];
    const selected = specializedNumericHandler(instruction.name, states[index]);
    if (selected) {
      plan.handlers[index] = selected.handler;
      ids[index] = selected.id;
    }
    const floatHandler = vm.options.typedNumericStack === true ? typedFloatHandler(instruction.name, states[index]) ??
      typedSlotHandler(method, instruction, states[index], plan.handlers[index]) : null;
    const longHandler = vm.options.smallLongFastPath === true ?
      smallLongHandler(method, instruction, states[index], plan.handlers[index]) : null;
    const typed = longHandler ?? floatHandler;
    if (!typed) continue;
    plan.handlers[index] = typed;
    ids[index] = instruction.name.replaceAll('.', '_') + '_typed';
    plan.typedNumericSlots = true;
  }
  plan.numericHandlerIds = Object.freeze(ids);
  plan.numericStackStates = Object.freeze(states);
  return plan;
}
