import {beginFrameInstruction} from './frame-stack.js';
import {flushFramePool} from './frame-pool.js';
import {ManagedFault} from '../heap.js';
import {prepareCall} from './calls.js';
import {getDecodePlan} from './decode-plan.js';
import {cilHandlers} from './handlers/index.js';
import {dispatchWasmCall, observeWasmBackedge} from './wasm/call-tier-state.js';

const dispatching = new WeakSet();
export const cilStepActive = vm => dispatching.has(vm);

/** Execute exactly one existing debugger-visible CIL instruction. */
export function executeCilStep(vm, dispatcher = null) {
  const nested = dispatching.has(vm);
  dispatching.add(vm);
  try {
    const frame = vm.top;
    const frameId = frame.id;
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
    let succeeded = false;
    try {
      profiler?.instruction(frame);
      if (dispatcher) dispatcher(vm, frame, instruction, index, handler);
      else dispatchWasmCall(vm, frame, instruction, index, handler);
      observeWasmBackedge(vm, frame, instruction, index, frameId);
      succeeded = true;
    } finally {
      flushFramePool(vm);
      profiler?.endInstruction(succeeded);
    }
  } finally {
    if (!nested) dispatching.delete(vm);
  }
}
