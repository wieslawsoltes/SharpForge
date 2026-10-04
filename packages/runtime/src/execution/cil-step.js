import {ManagedFault} from '../heap.js';
import {prepareCall} from './calls.js';
import {getDecodePlan} from './decode-plan.js';
import {ensureTypedNumericFrame} from './typed-numeric-frame.js';
import {beginFrameInstruction, flushFramePool} from './frame-pool.js';
import {executeTieredInstruction, deoptWasmTier} from './wasm/tiering.js';
import {collectAtInstruction} from './gc-stress.js';
import {resumeArrayOperation} from './array-ops.js';
import {validateSliceBudget} from './slice-budget.js';

const executionStates = new WeakMap();

export function cilExecutionState(vm) {
  const state = executionStates.get(vm);
  if (state !== undefined || executionStates.has(vm)) return state;
  // Snapshot preflight creates temporary contexts inheriting from the owning VM.
  return Object.getPrototypeOf(vm)?.state;
}

/** All debugger pause routes share this transition, including writes inside a Wasm import. */
export function setCilExecutionState(vm, state) {
  const previous = executionStates.get(vm);
  executionStates.set(vm, state);
  if (state === 'paused' && previous !== state && vm.options?.wasmTiering) deoptWasmTier(vm, 'debugger');
}

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

/** Run bounded guest work; profiler subscriber delivery remains outside managed fault dispatch. */
export function runCilSlice(vm, {instructionBudget = 15000, timeBudgetMs = 8, onInstruction = null} = {}) {
  validateSliceBudget(instructionBudget, timeBudgetMs);
  vm.scheduler.beforeSlice();
  if (vm.state === 'ready') vm.state = 'running';
  if (vm.state !== 'running') return vm.state;
  const started = performance.now();
  let count = 0;
  if (vm.pendingFault) {
    const pending = vm.pendingFault;
    vm.pendingFault = null;
    pending.exceptionDebuggerResume = true;
    vm.raise(pending);
  }
  while (vm.state === 'running' && vm.frames.length && count < instructionBudget) {
    if ((count & 255) === 0 && performance.now() - started >= timeBudgetMs) break;
    vm.scheduler.beforeInstruction();
    if (vm.state !== 'running' || !vm.frames.length) break;
    const frame = vm.top, continuing = !!frame.intrinsicContinuation;
    const instruction = frame.method.instructions[frame.pc];
    if (!continuing && instruction && onInstruction?.(instruction, frame)) {
      vm.state = 'paused';
      break;
    }
    if (!continuing) {
      count++;
      vm.instructions++;
      if (vm.profiler) vm.profiler.instruction(frame);
    }
    try {
      if (vm.instructions > vm.options.maxInstructions || continuing && vm.instructions >= vm.options.maxInstructions) {
        throw new ManagedFault('InstructionLimitException', 'Program exceeded its instruction budget');
      }
      if (continuing) {
        const result = resumeArrayOperation(vm, frame, {deadline: started + timeBudgetMs, workBudget: 1});
        count += result.work;
        vm.instructions += result.work;
        if (vm.profiler) vm.profiler.instruction(frame, result.work);
        if (!result.work) break;
      } else vm.step();
    } catch (error) {
      const fault = error instanceof ManagedFault ? error : new ManagedFault('InvalidProgramException', error.message ?? String(error));
      fault.phase = 'first-chance';
      fault.frames ??= [...vm.frames].reverse().map(item => ({
        method: item.method.owner + '::' + item.method.name, methodToken: item.method.token, ilOffset: item.lastOffset
      }));
      vm.raise(fault);
    }
    flushFramePool(vm);
    collectAtInstruction(vm);
    vm.scheduler.afterInstruction();
  }
  vm.elapsedMs += performance.now() - started;
  if (vm.profiler) vm.profiler.boundary();
  return vm.state;
}
