import {Op} from '@sharpforge/bytecode';
import {executionCodeState} from './code-version.js';
import {buildSourceFusionPlan} from './source-fusion-plan.js';

/** Executable plans are private derived data, invalidated with their code owner and type-system epoch. */
export function getSourceFusionPlan(vm, method) {
  const state = executionCodeState(vm);
  const cache = state.source ??= {methods: new WeakMap(), lastMethod: null, lastEntry: null};
  if (cache.lastMethod === method && cache.lastEntry.code === method.code && cache.lastEntry.handlers === method.handlers) {
    return cache.lastEntry.plan;
  }
  let entry = cache.methods.get(method);
  if (!entry || entry.code !== method.code || entry.handlers !== method.handlers) {
    entry = {code: method.code, handlers: method.handlers, plan: buildSourceFusionPlan(method, state.statistics)};
    cache.methods.set(method, entry);
  }
  cache.lastMethod = method;
  cache.lastEntry = entry;
  return entry.plan;
}

/** Report actual preparation work, including verified methods with no eligible instruction groups. */
export function prepareSourceExecution(vm) {
  if (vm.options.sourceFusion === false) return Object.freeze({status: 'disabled', methods: 0, fusedInstructions: 0});
  let methods = 0, fusedInstructions = 0;
  for (const method of vm.image.methods) {
    fusedInstructions += getSourceFusionPlan(vm, method).fusedInstructions;
    methods++;
  }
  return Object.freeze({status: 'prepared', methods, fusedInstructions});
}

export function executeSourceFusion(vm, frame, group) {
  executionCodeState(vm).statistics.sourceFusionGroups++;
  group.execute(vm, frame, group);
}

/** One group never crosses an observer, sequence, scheduler, EH or budget boundary. */
export function selectSourceFusion(vm, frame, method, remaining, onSequence) {
  const opcode = method.code[frame.pc * 3];
  if ((opcode !== Op.LDLOC && opcode !== Op.BINARY) || remaining < 2 || vm.options.sourceFusion === false ||
      vm.scheduler.enabled || vm.scheduler.suppressed ||
      onSequence || vm.onWrite || vm.onException || vm.profiler || vm.options.profile || vm.runtimeEvents ||
      vm.options.gcStress === 'instruction' || frame.intrinsicContinuation || frame.filterSearch ||
      frame.unwinds?.length || method.handlers.length) return null;
  const group = getSourceFusionPlan(vm, method).groups[frame.pc];
  return group && group.length <= remaining && group.length <= vm.options.maxInstructions - vm.instructions ? group : null;
}
