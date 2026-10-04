import {beginFrameInstruction} from './frame-stack.js';
import {floatSlots} from './typed-stack.js';
import {getDecodePlan} from './decode-plan.js';
import {executionCodeState} from './code-version.js';
import {executeNumericOperations} from './numeric-block-execution.js';

const contexts = new WeakMap();

function contextFor(frame, stack, locals, arguments_) {
  let context = contexts.get(frame);
  if (!context || context.stack !== stack || context.locals !== locals || context.arguments !== arguments_) {
    context = {stack, locals, arguments: arguments_};
    contexts.set(frame, context);
  }
  return context;
}

function observed(vm, frame, onInstruction) {
  return onInstruction || vm.onWrite || vm.onException || vm.profiler || vm.options.profile || vm.runtimeEvents ||
    vm.options.gcStress === 'instruction' || vm.options.wasmTiering || vm.scheduler.enabled || vm.scheduler.suppressed ||
    Object.hasOwn(vm.scheduler, 'beforeInstruction') || Object.hasOwn(vm.scheduler, 'afterInstruction') ||
    Object.hasOwn(vm, 'step') || Object.hasOwn(vm, 'push') || Object.hasOwn(vm, 'pop') ||
    frame.needsInitialization || frame.method.handlers.length || frame.intrinsicContinuation || frame.objectValueWork ||
    frame.objectValueContinuation || frame.filterSearch || frame.unwind || frame.exceptionEventContinuation || frame.delegateContinuation;
}

/** One bounded numeric block keeps all observable instruction boundaries on the ordinary interpreter. */
export function executeCilNumericBlock(vm, frame, remaining, onInstruction = null) {
  if (remaining < 1 || vm.options.decodePlans === false ||
      vm.options.specializeNumericHandlers !== true && vm.options.smallLongs !== true || observed(vm, frame, onInstruction)) return 0;
  const stack = floatSlots(frame.stack), locals = floatSlots(frame.locals), arguments_ = floatSlots(frame.args);
  if (!stack || !locals || !arguments_ || vm.options.scalarSlotLoads === false) return 0;
  const operations = getDecodePlan(vm, frame.method).numericBlocks;
  if (!operations?.[frame.pc]) return 0;
  const budget = Math.min(64, remaining, vm.options.maxInstructions - vm.instructions);
  if (budget < 1) return 0;
  try { beginFrameInstruction(vm, frame); }
  catch (error) {
    vm.instructions++;
    throw error;
  }
  const work = executeNumericOperations(vm, frame, operations, contextFor(frame, stack, locals, arguments_), budget);
  if (work) {
    const statistics = executionCodeState(vm).statistics;
    statistics.numericBlocks = (statistics.numericBlocks ?? 0) + 1;
    statistics.numericBlockInstructions = (statistics.numericBlockInstructions ?? 0) + work;
  }
  return work;
}
