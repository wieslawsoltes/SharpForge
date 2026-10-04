import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {resumeArrayOperation, cancelArrayOperation} from './array-continuations.js';
import {handleSourceInstructionFault} from './source-stack-admission.js';
import {flushFramePool} from './frame-pool.js';

/** Charge one bounded intrinsic unit using the calling opcode's existing profiler/fault identity. */
export function resumeSourceArrayContinuation(vm, frame, deadline = Infinity) {
  if (performance.now() >= deadline) return 0;
  try {
    if (vm.options.gcStress === 'instruction') vm.heap.collect();
    vm.instructions++;
    if (vm.instructions > vm.options.maxInstructions) {
      throw new ManagedFault('InstructionLimitException', 'Program exceeded its instruction budget');
    }
    vm.profiler?.instruction(frame);
    const result = resumeArrayOperation(vm, frame);
    if (result.done && result.returns) vm.stack.push(result.value);
  } catch (error) {
    cancelArrayOperation(frame);
    handleSourceInstructionFault(vm, error, {frame, opcode: Op.BUILTIN, index: frame.pc - 1,
      method: frame.methodId, frameId: frame.id});
  } finally { flushFramePool(vm); }
  return 1;
}
