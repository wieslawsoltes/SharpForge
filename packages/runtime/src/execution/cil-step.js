import {beginFrameInstruction} from './frame-stack.js';
import {flushFramePool} from './frame-pool.js';
import {ManagedFault} from '../heap.js';
import {prepareCall} from './calls.js';
import {getDecodePlan} from './decode-plan.js';
import {cilHandlers} from './handlers/index.js';

/** Execute exactly one existing debugger-visible CIL instruction. */
export function executeCilStep(vm) {
  const frame = vm.top;
  beginFrameInstruction(vm, frame);
  if (frame.needsInitialization && !prepareCall(vm, frame)) return;
  const plan = vm.options.decodePlans === false ? null : getDecodePlan(vm, frame.method);
  const index = frame.pc++;
  const instruction = (plan?.instructions ?? frame.method.instructions)[index];
  if (!instruction) {
    throw new ManagedFault('InvalidProgramException', 'Instruction pointer is outside the method');
  }
  frame.lastOffset = instruction.offset;
  if (plan) frame.offsets = plan.offsets;
  const handler = plan ? plan.handlers[index] : cilHandlers.get(instruction.name);
  if (!handler) {
    throw new ManagedFault('NotSupportedException', `Opcode '${instruction.name}' is not executable`);
  }
  const profiler = vm.profiler;
  profiler?.instruction(frame);
  let succeeded = false;
  try {
    handler(vm, frame, instruction);
    succeeded = true;
  } finally {
    flushFramePool(vm);
    profiler?.endInstruction(succeeded);
  }
}
