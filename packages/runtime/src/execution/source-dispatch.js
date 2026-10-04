import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../gc/fault.js';
import {sourceInstructionHandlers} from './source-instructions.js';

function dispatchFault(vm, error) {
  const fault = vm.makeFault(error);
  if (fault.name === 'InstructionLimitException') {
    vm.heap.writeRoot(vm, 'fault', fault);
    vm.state = 'faulted';
  } else if (vm.onException?.(fault)) {
    vm.heap.writeRoot(vm, 'pendingFault', fault);
    vm.state = 'paused';
  } else vm.handleFault(fault);
}

/** Source dispatch registration seam; GC polls occur only with materialized managed frames. */
export function runSourceSlice(vm, {instructionBudget = 15000, timeBudgetMs = 8, onSequence = null} = {}) {
  vm.gcRuntime?.beforeSlice();
  vm.scheduler.beforeSlice();
  if (vm.state === 'ready') vm.state = 'running';
  if (vm.state !== 'running') return vm.state;
  const started = performance.now();
  let count = 0;
  if (vm.pendingFault) {
    const pending = vm.pendingFault;
    vm.pendingFault = null;
    vm.handleFault(pending);
  }
  while (vm.state === 'running' && vm.frames.length && count < instructionBudget) {
    if ((count & 255) === 0 && performance.now() - started >= timeBudgetMs) break;
    vm.scheduler.beforeInstruction();
    if (vm.state !== 'running' || !vm.frames.length) break;
    const frame = vm.top;
    const method = vm.image.methods[frame.methodId];
    const pc = frame.pc;
    const base = pc * 3;
    const opcode = method.code[base];
    if (opcode === Op.SEQ) {
      frame.point = vm.image.sequencePoints[method.code[base + 1]];
      vm.currentPoint = frame.point;
      if (onSequence?.(frame.point, frame)) {
        vm.sourcePause = true;
        vm.state = 'paused';
        break;
      }
    }
    vm.sourcePause = false;
    frame.pc++;
    count++;
    vm.instructions++;
    try {
      if (vm.instructions > vm.options.maxInstructions) throw new ManagedFault('InstructionLimitException', 'Program exceeded its instruction budget');
      vm.gcRuntime?.beforeInstruction(frame, opcode);
      const handler = sourceInstructionHandlers.get(opcode);
      if (!handler) throw new ManagedFault('InvalidProgramException', 'Unknown instruction');
      handler(vm, frame, method.code[base + 1], method.code[base + 2]);
      vm.gcRuntime?.afterInstruction(frame, pc, opcode);
    } catch (error) {
      dispatchFault(vm, error);
    }
    vm.scheduler.afterInstruction();
  }
  vm.currentPoint = vm.top?.point ?? null;
  vm.elapsedMs += performance.now() - started;
  vm.gcRuntime?.afterSlice();
  return vm.state;
}
