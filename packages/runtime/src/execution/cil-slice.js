import {flushFramePool} from './frame-pool.js';
import {ManagedFault} from '../heap.js';
import {fatalFaults} from './eh.js';
import {flushCilMethodEvents} from './cil-method-events.js';

function raiseInstructionFault(vm, error) {
  const fault = error instanceof ManagedFault ? error : new ManagedFault('InvalidProgramException', error.message ?? String(error));
  fault.frames ??= [...vm.frames].reverse().map(frame => ({
    method: frame.method.owner + '::' + frame.method.name,
    methodToken: frame.method.token, ilOffset: frame.lastOffset
  }));
  if (!fatalFaults.has(fault.name) && vm.onException?.(fault)) {
    vm.pendingFault = fault;
    vm.state = 'paused';
  } else vm.raise(fault);
}

/** Existing cooperative CIL loop, with host observer delivery outside managed fault dispatch. */
export function runCilSlice(vm, {instructionBudget = 15000, timeBudgetMs = 8, onInstruction = null} = {}) {
  let started;
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
      const instruction = vm.top.method.instructions[vm.top.pc];
      if (instruction && onInstruction?.(instruction, vm.top)) {
        vm.state = 'paused';
        break;
      }
      count++;
      vm.instructions++;
      try {
        if (vm.instructions > vm.options.maxInstructions) {
          throw new ManagedFault('InstructionLimitException', 'Program exceeded its instruction budget');
        }
        vm.step();
      } catch (error) {
        raiseInstructionFault(vm, error);
      }
      flushFramePool(vm);
      vm.scheduler.afterInstruction();
    }
    return vm.state;
  } finally {
    if (started !== undefined) vm.elapsedMs += performance.now() - started;
    flushFramePool(vm);
    vm.profiler?.closeSlice();
    flushCilMethodEvents(vm);
    vm.profiler?.reportClockFailure();
  }
}
