import * as runtime from '@sharpforge/runtime';
import {AssemblyInspector, loadAssembly} from '@sharpforge/cil';
import {compileFixture, hostMemory, managedMemory, samplePhase, abortIfNeeded} from './operations.js';
import {hash} from './evidence.js';
import {pairedTarget, summarizeMeasurements} from './qualification-statistics.js';
import {requireQualificationOptions} from './qualification-options.js';

class CountingInspector extends AssemblyInspector {
  resolveToken(token) {
    this.resolveTokenCalls = (this.resolveTokenCalls ?? 0) + 1;
    return super.resolveToken(token);
  }
}

export function qualificationVmOptions(options) {
  return {nativeIntBits: options.nativeBits, maxInstructions: 1000000000, maxFrames: 512,
    sourceFusion: false, specializeNumericHandlers: false, smallLongs: false, typedNumericStack: false,
    scalarSlotLoads: true, inlineCaches: true, preciseRoots: true, preciseRootLiveness: false,
    framePooling: true, wasmTiering: false, profile: false};
}

export function checkQualificationLimit(deadline, signal) {
  abortIfNeeded(signal);
  if (performance.now() >= deadline) throw new Error('Qualification exceeded its explicit time limit');
}

/** One VM executes serial cooperative slices; waiting and debugger stops never become successful samples. */
export async function runQualificationVM(vm, deadline, signal) {
  while (vm.state === 'ready' || vm.state === 'running') {
    checkQualificationLimit(deadline, signal);
    vm.runSlice({instructionBudget: 10000, timeBudgetMs: 8});
    if (vm.state === 'running') await new Promise(resolve => setImmediate(resolve));
  }
  checkQualificationLimit(deadline, signal);
  if (vm.state !== 'terminated' || vm.fault || vm.pendingFault) {
    throw new Error('Qualification guest did not terminate: ' + (vm.fault?.message ?? vm.state));
  }
}

function createContext(definition, artifact, options, mode) {
  const api = definition[mode + 'Runtime'] ?? runtime;
  const vmOptions = {...qualificationVmOptions(options), ...definition[mode + 'Options']};
  const start = performance.now();
  const bytes = definition.countTokens ? new CountingInspector(artifact.assembly) : artifact.assembly;
  const vm = definition.engine === 'cil' ? new api.CilVirtualMachine(bytes, vmOptions)
    : new api.VirtualMachine(definition.engine === 'source' ? artifact.image : loadAssembly(artifact.assembly), vmOptions);
  try {
    const constructionMs = performance.now() - start, prepareStart = performance.now();
    const preparation = api.prepareExecution(vm), preparationMs = performance.now() - prepareStart;
    vm.heap.collect();
    return {vm, api, entry: vm.inspector ? vm.top.method.token : vm.top.methodId,
      baselineLiveObjects: vm.heap.stats.liveObjects, cold: {constructionMs, preparationMs, preparation}, options: vmOptions};
  } catch (error) { vm.stop(); throw error; }
}

function reenter(context) {
  const {vm, entry} = context;
  if (vm.state !== 'terminated') return;
  vm.output.length = 0;
  vm.outputCharacters = 0;
  vm.returnValue = null;
  vm.state = 'running';
  vm.call(entry, []);
}

function counters(context) {
  return {managed: managedMemory(context.vm), frames: context.api.framePoolStatistics(context.vm),
    code: context.api.executionCodeStatistics(context.vm), tokens: context.vm.inspector?.resolveTokenCalls ?? 0,
    profile: context.api.instructionProfile(context.vm)};
}

function assertResult(vm, fixture) {
  const result = typeof vm.resultValue === 'function' ? vm.resultValue() : vm.value(vm.returnValue);
  if (fixture.expected !== undefined && vm.output.join('') !== fixture.expected ||
      fixture.expectedReturn !== undefined && !Object.is(result, fixture.expectedReturn)) {
    throw new Error(fixture.id + ': unexpected qualification result ' + String(result) + ' / ' + vm.output.join(''));
  }
}

async function observe(context, definition, deadline, signal) {
  const {vm} = context;
  reenter(context);
  globalThis.gc?.();
  const before = counters(context), hostBefore = hostMemory(), startInstructions = vm.instructions;
  const started = performance.now();
  await runQualificationVM(vm, deadline, signal);
  const executionMs = performance.now() - started, hostAfter = hostMemory(), after = counters(context);
  assertResult(vm, definition.fixture);
  const instructions = vm.instructions - startInstructions;
  if (!(instructions > 0 && executionMs > 0)) throw new Error('Qualification observed no execution');
  const sample = {executionMs, instructions, nanosecondsPerInstruction: executionMs * 1000000 / instructions,
    instructionsPerSecond: instructions * 1000 / executionMs, hostBefore, hostAfter, outputVerified: true,
    managedAllocations: after.managed.allocations - before.managed.allocations,
    managedAllocatedBytes: after.managed.allocatedBytes - before.managed.allocatedBytes,
    framesAllocated: after.frames.framesAllocated - before.frames.framesAllocated,
    frameArraysAllocated: after.frames.arraysAllocated - before.frames.arraysAllocated,
    offsetMapAllocations: after.code.offsetMapAllocations - before.code.offsetMapAllocations,
    sourceFusionGroups: after.code.sourceFusionGroups - before.code.sourceFusionGroups,
    tokenResolutions: after.tokens - before.tokens};
  if (after.profile) {
    sample.profiledInstructions = after.profile.instructions - before.profile.instructions;
    if (sample.profiledInstructions !== instructions) throw new Error('Enabled profiler did not count every guest instruction');
  }
  if (definition.target?.kind === 'zero-warm-frame-storage') {
    vm.heap.collect();
    sample.liveObjectsAfterCollection = vm.heap.stats.liveObjects;
    sample.baselineLiveObjects = context.baselineLiveObjects;
    if (sample.liveObjectsAfterCollection !== context.baselineLiveObjects) throw new Error('Unwound recursion retained managed objects');
  }
  return sample;
}

function decideTarget(row, definition, options) {
  const baseline = row.samples.baseline.filter(sample => sample.phase === 'measured');
  const candidate = row.samples.candidate.filter(sample => sample.phase === 'measured');
  const kind = definition.target?.kind;
  const counterTargets = {
    'zero-warm-frame-storage': {check: sample => sample.framesAllocated === 0 && sample.frameArraysAllocated === 0 &&
      sample.liveObjectsAfterCollection === sample.baselineLiveObjects, evidence: 'Exact frame-pool and managed-live-object counters'},
    'zero-warm-token-resolution': {check: sample => sample.tokenResolutions === 0, evidence: 'Inspector subclass call counter'},
    'zero-warm-offset-maps': {check: sample => sample.offsetMapAllocations === 0, evidence: 'Decode-plan offset-map allocation counter'}
  };
  if (counterTargets[kind]) {
    const met = candidate.every(counterTargets[kind].check);
    return {...definition.target, acceptance: met ? 'met' : 'missed', meetsPointTarget: met,
      evidence: counterTargets[kind].evidence};
  }
  const metric = definition.metric ?? 'executionMs';
  return definition.target ? pairedTarget(baseline.map(sample => sample[metric]), candidate.map(sample => sample[metric]),
    definition.target, {seed: options.seed, resamples: options.resamples}) : {acceptance: 'reported', kind: 'observed-overhead',
    observed: row.summary.candidate.executionMs.median / row.summary.baseline.executionMs.median - 1};
}

/** Reentry preserves warmed caches and pooled frames; no restore or code invalidation occurs between observations. */
export async function measureExecutionPair(definition, options, signal) {
  requireQualificationOptions(options);
  const started = performance.now(), artifact = definition.build?.() ?? compileFixture(definition.fixture);
  const row = {id: definition.id, issue: definition.issue, engine: definition.engine, status: 'running',
    assemblyHash: hash(artifact.assembly), compilationMs: performance.now() - started, note: definition.note,
    metric: definition.metric ?? 'executionMs', samples: {baseline: [], candidate: []}};
  const contexts = {};
  const deadline = started + options.timeoutSeconds * 1000;
  try {
    for (const mode of ['baseline', 'candidate']) contexts[mode] = createContext(definition, artifact, options, mode);
    row.cold = Object.fromEntries(Object.entries(contexts).map(([mode, context]) => [mode, context.cold]));
    row.vmOptions = Object.fromEntries(Object.entries(contexts).map(([mode, context]) => [mode, context.options]));
    for (const handler of definition.expectedHandlers ?? []) {
      if (!row.cold.candidate.preparation.numericHandlerCounts?.[handler]) throw new Error('Expected handler was not selected: ' + handler);
    }
    for (let index = 0; index < options.samples + options.warmup + 1; index++) {
      for (const mode of index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
        const sample = await observe(contexts[mode], definition, deadline, signal);
        row.samples[mode].push({index, phase: samplePhase(index, options.warmup), ...sample});
      }
      const baseline = row.samples.baseline.at(-1), candidate = row.samples.candidate.at(-1);
      if (baseline.instructions !== candidate.instructions) throw new Error('Compared modes changed guest instruction counts');
      if (definition.candidateOptions.sourceFusion && candidate.sourceFusionGroups === 0) {
        throw new Error('Source fusion target executed no fused groups');
      }
    }
    row.summary = Object.fromEntries(Object.entries(row.samples).map(([mode, samples]) => [mode, summarizeMeasurements(samples)]));
    row.target = decideTarget(row, definition, options);
    row.status = 'measured';
    return row;
  } catch (error) {
    row.status = signal?.aborted ? 'cancelled' : 'failed';
    error.evidence = row;
    throw error;
  } finally {
    for (const context of Object.values(contexts)) context.vm.stop();
  }
}
