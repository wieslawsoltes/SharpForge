import {resumeSourceArrayContinuation} from './source-array-continuations.js';
import {resumeSourceObjectValueWork} from './object-value-slice.js';
import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {dispatchSourceOpcode} from './source-ops/index.js';
import {beginSourceStackInstruction, handleSourceInstructionFault} from './source-stack-admission.js';
import {flushFramePool} from './frame-pool.js';
import {flushSourceRuntimeEvents} from './source-runtime-events.js';
import {selectSourceFusion} from './source-fusion.js';
import {executeSourceFusionBatch} from './source-fusion-batch.js';

// Capture only the slice's observer identity; its method remains observable at each instruction.
function instructionDispatcher(profiler) {
  if (profiler === null || profiler === undefined) return dispatchSourceOpcode;
  return (vm, frame, opcode, first, second) => {
    profiler.instruction(frame);
    return dispatchSourceOpcode(vm, frame, opcode, first, second);
  };
}

function executeInstructions(vm, {instructionBudget, timeBudgetMs, onSequence, started}, dispatch) {
  let count = 0;
  while (vm.state === 'running' && vm.frames.length && count < instructionBudget) {
    if ((count & 255) === 0 && performance.now() - started >= timeBudgetMs) break;
    if (vm.scheduler.enabled) vm.scheduler.beforeInstruction();
    if (vm.state !== 'running' || !vm.frames.length) break;
    const frame = vm.top;
    if (frame.objectValueWork || frame.intrinsicContinuation?.kind === 'array') {
      const resume = frame.objectValueWork ? resumeSourceObjectValueWork : resumeSourceArrayContinuation;
      const work = resume(vm, frame, started + timeBudgetMs);
      if (!work) break;
      count += work;
      if (vm.scheduler.enabled) vm.scheduler.afterInstruction();
      continue;
    }
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
      if (group) {
        if (!executeSourceFusionBatch(vm, frame, group, remaining)) break;
      } else {
        if (vm.options.gcStress === 'instruction') vm.heap.collect();
        frame.pc++;
        vm.instructions++;
        if (vm.instructions > vm.options.maxInstructions) {
          throw new ManagedFault('InstructionLimitException', 'Program exceeded its instruction budget');
        }
        if (!dispatch(vm, frame, opcode, first, second)) {
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
  const dispatch = instructionDispatcher(profiler);
  try {
    vm.scheduler.beforeSlice();
    if (vm.state === 'ready') vm.state = 'running';
    if (vm.state !== 'running') return vm.state;
    const started = performance.now();
    if (vm.pendingFault) {
      const pending = vm.pendingFault;
      vm.pendingFault = null;
      pending.exceptionDebuggerResume = true;
      vm.handleFault(pending);
      vm.scheduler.beforeInstruction();
    }
    executeInstructions(vm, {instructionBudget, timeBudgetMs, onSequence, started}, dispatch);
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
