import {executionCodeState} from './code-version.js';
import {flushFramePool} from './frame-pool.js';
import {beginSourceStackInstruction, handleSourceInstructionFault} from './source-stack-admission.js';
import {executeSourceFusion, selectSourceFrameFusion} from './source-fusion.js';

/** Reuse observer eligibility only until the caller's instruction or 256-instruction clock boundary. */
export function executeSourceFusionBatch(vm, frame, group, remaining) {
  const state = executionCodeState(vm);
  const started = vm.instructions;
  while (group) {
    const methodId = frame.methodId;
    const frameId = frame.id;
    const code = vm.image.methods[methodId].code;
    let next;
    try {
      next = executeSourceFusion(vm, frame, group, remaining - (vm.instructions - started), state);
    } catch (error) {
      // A call can change vm.top, so fault ownership is the block's original executing frame.
      const index = frame.pc - 1;
      return handleSourceInstructionFault(vm, error, {frame, opcode: code[index * 3], index, method: methodId, frameId});
    } finally {
      // Return continuations have finished. Revoke/clear storage before the next block can reuse it.
      flushFramePool(vm);
    }
    const budget = remaining - (vm.instructions - started);
    if (next === false || budget < 2 || vm.state !== 'running' || !vm.frames.length) return true;
    frame = vm.top;
    group = selectSourceFrameFusion(vm, frame, vm.image.methods[frame.methodId], budget, state);
    if (group && !beginSourceStackInstruction(vm, frame)) return false;
  }
  return true;
}
