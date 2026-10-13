import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {dispatchSourceOpcode} from './source-ops/index.js';
import {beginSourceStackInstruction, handleSourceInstructionFault} from './source-stack-admission.js';
import {flushFramePool} from './frame-pool.js';
import {flushSourceRuntimeEvents} from './source-runtime-events.js';
import {selectSourceFusion, executeSourceFusion} from './source-fusion.js';

function executeInstructions(vm, {instructionBudget, timeBudgetMs, onSequence, profiler, started}) {
  let count = 0;
  while (vm.state === 'running' && vm.frames.length && count < instructionBudget) {
    if ((count & 255) === 0 && performance.now() - started >= timeBudgetMs) break;
    if (vm.scheduler.enabled) vm.scheduler.beforeInstruction();
    if (vm.state !== 'running' || !vm.frames.length) break;
    const frame = vm.top;
    const method = vm.image.methods[frame.methodId], code = method.code, base = frame.pc * 3;
    const opcode = code[base], first = code[base + 1], second = code[base + 2];
    const frameId = frame.id, methodId = frame.methodId;
    if (!beginSourceStackInstruction(vm, frame)) break;
    if (opcode === Op.SEQ) {
      frame.point = vm.image.sequencePoints[first];
      vm.currentPoint = frame.point;
      if (onSequence?.(frame.point, frame)) {
        vm.sourcePause = true;
        vm.state = 'paused';
        break;
      }
    }
    vm.sourcePause = false;
    // Do not skip the original 256-instruction wall-clock polling boundary.
    const remaining = Math.min(instructionBudget - count, 256 - (count & 255));
    const group = selectSourceFusion(vm, frame, method, remaining, onSequence);
    const before = vm.instructions;
    try {
      if (group) executeSourceFusion(vm, frame, group);
      else {
        frame.pc++;
        vm.instructions++;
        if (vm.instructions > vm.options.maxInstructions) {
          throw new ManagedFault('InstructionLimitException', 'Program exceeded its instruction budget');
        }
        profiler?.instruction(frame);
        if (!dispatchSourceOpcode(vm, frame, opcode, first, second)) {
          throw new ManagedFault('InvalidProgramException', 'Unknown instruction');
        }
      }
    } catch (error) {
      const index = group ? frame.pc - 1 : base / 3;
      const instruction = {frame, opcode: group ? code[index * 3] : opcode, index, method: methodId, frameId};
      if (!handleSourceInstructionFault(vm, error, instruction)) break;
    } finally {
      count += vm.instructions - before;
      flushFramePool(vm);
    }
    if (vm.scheduler.enabled) vm.scheduler.afterInstruction();
  }
}

/** Source instruction boundaries own quotas, sequence pauses and ordered observer delivery. */
export function runSourceSlice(vm, {instructionBudget = 15000, timeBudgetMs = 8, onSequence = null} = {}) {
  const profiler = vm.profiler;
  try {
    vm.scheduler.beforeSlice();
    if (vm.state === 'ready') vm.state = 'running';
    if (vm.state !== 'running') return vm.state;
    const started = performance.now();
    if (vm.pendingFault) {
      const pending = vm.pendingFault;
      vm.pendingFault = null;
      vm.handleFault(pending);
    }
    executeInstructions(vm, {instructionBudget, timeBudgetMs, onSequence, profiler, started});
    vm.currentPoint = vm.top?.point ?? null;
    vm.elapsedMs += performance.now() - started;
    return vm.state;
  } finally {
    flushFramePool(vm);
    profiler?.closeSlice();
    flushSourceRuntimeEvents(vm);
    profiler?.reportClockFailure();
  }
}
