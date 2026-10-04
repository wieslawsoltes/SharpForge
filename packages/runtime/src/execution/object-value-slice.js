import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {resumeObjectValueWork} from './object-value-operation.js';
import {handleSourceInstructionFault} from './source-stack-admission.js';
import {flushFramePool} from './frame-pool.js';

export function resumeCilObjectValueWork(vm, frame) {
  let succeeded = false;
  try {
    vm.profiler?.instruction(frame);
    resumeObjectValueWork(vm, frame);
    succeeded = true;
  } finally { vm.profiler?.endInstruction(succeeded); }
}

/** Shared equality also serves source array searches; each native quantum is an observable quota unit. */
export function resumeSourceObjectValueWork(vm, frame, deadline = Infinity) {
  if (performance.now() >= deadline) return 0;
  try {
    if (vm.options.gcStress === 'instruction') vm.heap.collect();
    vm.instructions++;
    if (vm.instructions > vm.options.maxInstructions) {
      throw new ManagedFault('InstructionLimitException', 'Program exceeded its instruction budget');
    }
    vm.profiler?.instruction(frame);
    resumeObjectValueWork(vm, frame);
  } catch (error) {
    handleSourceInstructionFault(vm, error, {frame, opcode: Op.BUILTIN, index: frame.pc - 1,
      method: frame.methodId, frameId: frame.id});
  } finally { flushFramePool(vm); }
  return 1;
}
