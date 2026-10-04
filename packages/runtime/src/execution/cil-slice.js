import {cancelArrayOperation} from './array-continuations.js';
import {resumeCilArrayContinuation} from './cil-array-continuations.js';
import {resumeCilObjectValueWork} from './object-value-slice.js';
import {flushFramePool} from './frame-pool.js';
import {ManagedFault} from '../heap.js';
import {isFatalFault} from './unhandled.js';
import {flushCilMethodEvents} from './cil-method-events.js';
import {emitCilException} from './cil-exception-events.js';
import {cancelObjectValueWork} from './object-value-state.js';
import {executeCilNumericBlock} from './numeric-blocks.js';

const slicing = new WeakSet();
export const cilSliceActive = vm => slicing.has(vm);

function raiseInstructionFault(vm, error, frame, instruction) {
  if (frame.intrinsicContinuation?.kind === 'array') cancelArrayOperation(frame);
  cancelObjectValueWork(frame);
  const fault = error instanceof ManagedFault ? error : new ManagedFault('InvalidProgramException', error.message ?? String(error));
  fault.frames ??= [...vm.frames].reverse().map(frame => ({
    method: frame.method.owner + '::' + frame.method.name,
    methodToken: frame.method.token, ilOffset: frame.lastOffset
  }));
  emitCilException(vm, fault, frame, instruction, isFatalFault(fault));
  vm.raise(fault);
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
      pending.exceptionDebuggerResume = true;
      vm.raise(pending);
      vm.scheduler.beforeInstruction();
    }
    while (vm.state === 'running' && vm.frames.length && count < instructionBudget) {
      if (timeBudgetMs !== Infinity && (count & 255) === 0 && performance.now() - started >= timeBudgetMs) break;
      vm.scheduler.beforeInstruction();
      if (vm.state !== 'running' || !vm.frames.length) break;
      const frame = vm.top;
      const continuingArray = frame.intrinsicContinuation?.kind === 'array';
      const continuingObject = !!frame.objectValueWork;
      const instruction = frame.method.instructions[continuingArray || continuingObject ? frame.pc - 1 : frame.pc];
      if (!continuingArray && !continuingObject && instruction && onInstruction?.(instruction, vm.top)) {
        vm.state = 'paused';
        break;
      }
      executor?.validate(vm);
      const before = vm.instructions;
      const firstPC = frame.pc;
      let numeric = !continuingArray && !continuingObject && !executor;
      try {
        const remaining = Math.min(instructionBudget - count, 256 - (count & 255));
        if (!numeric || !executeCilNumericBlock(vm, frame, remaining, onInstruction)) {
          numeric = false;
          vm.instructions++;
          if (vm.instructions > vm.options.maxInstructions) {
            throw new ManagedFault('InstructionLimitException', 'Program exceeded its instruction budget');
          }
          if (continuingObject || continuingArray) {
            if (vm.options.gcStress === 'instruction') vm.heap.collect();
            if (continuingObject) resumeCilObjectValueWork(vm, frame);
            else resumeCilArrayContinuation(vm, frame);
          } else if (executor) executor.step(vm);
          else vm.step();
        }
      } catch (error) {
        raiseInstructionFault(vm, error, frame, numeric && frame.pc !== firstPC ? frame.method.instructions[frame.pc - 1] : instruction);
      } finally {
        count += vm.instructions - before;
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
