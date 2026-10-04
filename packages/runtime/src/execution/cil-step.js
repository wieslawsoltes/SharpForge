import {beginFrameInstruction} from './frame-stack.js';
import {flushFramePool} from './frame-pool.js';
import {ManagedFault} from '../heap.js';
import {prepareCall} from './calls.js';
import {getDecodePlan} from './decode-plan.js';
import {cilHandlers} from './handlers/index.js';
import {dispatchWasmCall, observeWasmBackedge, selectWasmOsr} from './wasm/call-tier-state.js';
import {rejectCilOpcode} from './opcode-fault.js';

const dispatching = new WeakMap();
export const cilStepActive = vm => dispatching.get(vm) === true;

/** Execute exactly one existing debugger-visible CIL instruction. */
export function executeCilStep(vm, dispatcher = null) {
  const nested = dispatching.get(vm) === true;
  dispatching.set(vm, true);
  try {
    const frame = vm.top;
    const frameId = frame.id;
    if (vm.options.gcStress === 'instruction') vm.heap.collect();
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
    if (!handler) rejectCilOpcode(instruction.name);
    const profiler = vm.profiler;
    let succeeded = false;
    try {
      profiler?.instruction(frame);
      if (dispatcher) dispatcher(vm, frame, instruction, index, handler);
      else dispatchWasmCall(vm, frame, instruction, index, handler);
      const hotBackedge = observeWasmBackedge(vm, frame, instruction, index, frameId);
      if (!dispatcher && hotBackedge) selectWasmOsr(vm, frame, hotBackedge, frameId);
      succeeded = true;
    } finally {
      flushFramePool(vm);
      profiler?.endInstruction(succeeded);
    }
  } finally {
    if (!nested) dispatching.set(vm, false);
  }
}
