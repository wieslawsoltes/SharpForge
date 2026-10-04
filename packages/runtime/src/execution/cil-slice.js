import {flushFramePool} from './frame-pool.js';
import {ManagedFault} from '../heap.js';
import {fatalFaults} from './eh.js';
import {flushCilMethodEvents} from './cil-method-events.js';
import {emitCilException} from './cil-exception-events.js';

const slicing = new WeakSet();
export const cilSliceActive = vm => slicing.has(vm);

function raiseInstructionFault(vm, error, frame, instruction) {
  const fault = error instanceof ManagedFault ? error : new ManagedFault('InvalidProgramException', error.message ?? String(error));
  fault.frames ??= [...vm.frames].reverse().map(frame => ({
    method: frame.method.owner + '::' + frame.method.name,
    methodToken: frame.method.token, ilOffset: frame.lastOffset
  }));
  emitCilException(vm, fault, frame, instruction, fatalFaults.has(fault.name));
  if (!fatalFaults.has(fault.name) && vm.onException?.(fault)) {
    vm.pendingFault = fault;
    vm.state = 'paused';
  } else vm.raise(fault);
}

/** Existing cooperative CIL loop, with host observer delivery outside managed fault dispatch. */
export function runCilSlice(vm, {instructionBudget = 15000, timeBudgetMs = 8, onInstruction = null} = {}, executor = null) {
  let started;
  const nested = slicing.has(vm);
  slicing.add(vm);
  try {
    vm.profiler?.beginSlice();
    vm.scheduler.beforeSlice();
    if (vm.state === 'ready') vm.state = 'running';
    if (vm.state !== 'running') return vm.state;
    started = performance.now();
    let count = 0;
    if (vm.pendingFault) {
      const pending = vm.pendingFault;
      vm.pendingFault = null;
      vm.raise(pending);
    }
    while (vm.state === 'running' && vm.frames.length && count < instructionBudget) {
      if ((count & 255) === 0 && performance.now() - started >= timeBudgetMs) break;
      vm.scheduler.beforeInstruction();
      if (vm.state !== 'running' || !vm.frames.length) break;
      const frame = vm.top;
      const instruction = frame.method.instructions[frame.pc];
      if (instruction && onInstruction?.(instruction, vm.top)) {
        vm.state = 'paused';
        break;
      }
      executor?.validate(vm);
      count++;
      vm.instructions++;
      try {
        if (vm.instructions > vm.options.maxInstructions) {
          throw new ManagedFault('InstructionLimitException', 'Program exceeded its instruction budget');
        }
        if (executor) executor.step(vm);
        else vm.step();
      } catch (error) {
        raiseInstructionFault(vm, error, frame, instruction);
      }
      flushFramePool(vm);
      vm.scheduler.afterInstruction();
    }
    return vm.state;
  } finally {
    try {
      if (started !== undefined) vm.elapsedMs += performance.now() - started;
      flushFramePool(vm);
      vm.profiler?.closeSlice();
      flushCilMethodEvents(vm);
      vm.profiler?.reportClockFailure();
    } finally {
      if (!nested) slicing.delete(vm);
    }
  }
}
