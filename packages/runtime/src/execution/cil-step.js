import {ManagedFault} from '../heap.js';
import {prepareCall} from './calls.js';
import {getDecodePlan} from './decode-plan.js';
import {ensureTypedNumericFrame} from './typed-numeric-frame.js';
import {beginFrameInstruction, flushFramePool} from './frame-pool.js';
import {executeTieredInstruction} from './wasm/tiering.js';

/** Execute one existing debugger-visible instruction through its derived handler slot. */
export function executeCilStep(vm) {
  if (!prepareCall(vm)) return;
  const frame = vm.top;
  const plan = getDecodePlan(vm, frame.method);
  ensureTypedNumericFrame(vm, frame, plan);
  const index = frame.pc++;
  const instruction = plan.instructions[index];
  if (!instruction) throw new ManagedFault('InvalidProgramException', 'Instruction pointer is outside the method');
  frame.lastOffset = instruction.offset;
  beginFrameInstruction(vm, frame);
  try {
    if (vm.options.wasmTiering) executeTieredInstruction(vm, frame, plan, index);
    else plan.handlers[index](vm, frame, instruction);
  }
  finally { flushFramePool(vm); }
}
