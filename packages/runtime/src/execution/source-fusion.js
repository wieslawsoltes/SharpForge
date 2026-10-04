import {hasCanonicalSourceAdapters} from './source-adapter-guard.js';
import {executionCodeState} from './code-version.js';
import {buildSourceFusionPlan} from './source-fusion-plan.js';

/** Executable plans are private derived data, invalidated with their code owner and type-system epoch. */
export function getSourceFusionPlan(vm, method, state = executionCodeState(vm)) {
  const cache = state.source ??= {methods: new WeakMap(), lastMethod: null, lastEntry: null};
  if (cache.lastMethod === method && cache.lastEntry.code === method.code && cache.lastEntry.handlers === method.handlers) {
    return cache.lastEntry.plan;
  }
  let entry = cache.methods.get(method);
  if (!entry || entry.code !== method.code || entry.handlers !== method.handlers) {
    entry = {code: method.code, handlers: method.handlers, plan: buildSourceFusionPlan(method, state.statistics, vm.image)};
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

export function executeSourceFusion(vm, frame, group, remaining, state = executionCodeState(vm)) {
  state.statistics.sourceFusionGroups++;
  // Ordinary dispatch charges the first whole instruction beyond a fractional host limit before faulting.
  const quota = Math.floor(vm.options.maxInstructions - vm.instructions);
  const length = Math.min(group.length, remaining, quota);
  return group.execute(vm, frame, group, length);
}

/** Frame-specific barriers remain observable when an unobserved batch crosses ordinary managed calls. */
export function selectSourceFrameFusion(vm, frame, method, remaining, state) {
  if (remaining < 2 || !(vm.options.maxInstructions - vm.instructions >= 2) ||
      frame.intrinsicContinuation || frame.filterSearch || frame.exceptionEventContinuation ||
      frame.delegateContinuation || frame.unwinds?.length || method.handlers.length ||
      frame.objectValueWork || frame.objectValueContinuation || frame.objectStringReturn) return null;
  return getSourceFusionPlan(vm, method, state).groups[frame.pc];
}

/** Only callback-free source execution can keep eligibility through a bounded batch. */
export function selectSourceFusion(vm, frame, method, remaining, onSequence) {
  if (remaining < 2 || vm.options.sourceFusion === false ||
      vm.scheduler.enabled || vm.scheduler.suppressed ||
      onSequence || vm.onWrite || vm.onException || vm.profiler || vm.options.profile || vm.runtimeEvents ||
      vm.options.gcStress === 'instruction' || !hasCanonicalSourceAdapters(vm)) return null;
  return selectSourceFrameFusion(vm, frame, method, remaining);
}
