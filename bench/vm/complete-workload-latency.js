import {framePoolStatistics, prepareExecution} from '@sharpforge/runtime';
import {assertOutput, createVM, hostMemory, managedMemory, samplePhase, abortIfNeeded} from './operations.js';
import {checkQualificationLimit, runQualificationVM} from './qualification-execution.js';
import {distribution} from './statistics.js';
import {hash} from './evidence.js';

const engines = new Set(['source', 'reloaded', 'cil']);
const counterKeys = ['managedAllocations', 'managedAllocatedBytes', 'collections', 'framesAllocated', 'frameArraysAllocated'];

export function workloadLatencyVmOptions(options) {
  return {nativeIntBits: options.nativeBits, maxInstructions: 10000000, profile: false, wasmTiering: false,
    sourceFusion: true, inlineCaches: true, specializeNumericHandlers: true, smallLongs: true,
    scalarSlotLoads: true, framePooling: true, typedNumericStack: false};
}

function counters(vm) {
  const managed = managedMemory(vm), frames = framePoolStatistics(vm);
  return {managedAllocations: managed.allocations, managedAllocatedBytes: managed.allocatedBytes,
    collections: vm.heap.stats.collections, framesAllocated: frames.framesAllocated, frameArraysAllocated: frames.arraysAllocated};
}

function delta(after, before) {
  return Object.fromEntries(counterKeys.map(key => {
    const value = after[key] - (before?.[key] ?? 0);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid workload allocation counter: ' + key);
    return [key, value];
  }));
}

function summarize(samples, timeKeys) {
  return Object.fromEntries([...timeKeys, ...counterKeys].map(key => {
    const summary = distribution(samples.map(sample => sample[key]));
    return [key, {...summary, p50: summary.median}];
  }));
}

function verify(vm, instructionStart, fixture) {
  assertOutput(vm, fixture);
  const instructions = vm.instructions - instructionStart;
  if (!Number.isSafeInteger(instructions) || instructions <= 0) throw new Error('Complete workload made no guest progress');
  return instructions;
}

async function coldSample(context) {
  const {engine, artifact, options, deadline, signal, fixture} = context;
  checkQualificationLimit(deadline, signal);
  globalThis.gc?.();
  const hostBefore = hostMemory(), started = performance.now();
  let vm;
  try {
    vm = createVM(engine, artifact, workloadLatencyVmOptions(options));
    const constructed = performance.now(), preparation = prepareExecution(vm);
    if (preparation.status !== 'prepared') throw new Error('Workload preparation unavailable: ' + preparation.status);
    const prepared = performance.now(), instructionStart = vm.instructions;
    await runQualificationVM(vm, deadline, signal);
    const finished = performance.now(), after = counters(vm), hostAfter = hostMemory();
    return {constructionMs: constructed - started, preparationMs: prepared - constructed,
      executionMs: finished - prepared, totalMs: finished - started,
      ...delta(after), instructions: verify(vm, instructionStart, fixture), outputVerified: true, preparation,
      output: vm.output.join(''), backend: vm.inspector ? 'CilVirtualMachine' : 'VirtualMachine', hostBefore, hostAfter};
  } finally { vm?.stop(); }
}

async function warmSamples(context, row) {
  const {engine, artifact, options, deadline, signal, fixture} = context;
  checkQualificationLimit(deadline, signal);
  const vm = createVM(engine, artifact, workloadLatencyVmOptions(options));
  try {
    const entry = vm.inspector ? vm.top.method.token : vm.top.methodId;
    row.warmPreparation = prepareExecution(vm);
    if (row.warmPreparation.status !== 'prepared') throw new Error('Workload warm preparation unavailable');
    for (let index = 0; index <= options.warmup + options.samples; index++) {
      checkQualificationLimit(deadline, signal);
      const first = index === 0;
      if (!first) {
        vm.output.length = 0;
        vm.outputCharacters = 0;
        vm.returnValue = null;
        vm.state = 'running';
      }
      globalThis.gc?.();
      const hostBefore = hostMemory(), before = counters(vm), instructionStart = vm.instructions;
      const started = performance.now();
      // Admission is part of each repeated complete execution; caches and pools remain warm.
      if (!first) vm.call(entry, []);
      await runQualificationVM(vm, deadline, signal);
      const executionMs = performance.now() - started, after = counters(vm), hostAfter = hostMemory();
      row.warm.push({index, phase: samplePhase(index, options.warmup), executionMs, ...delta(after, before),
        instructions: verify(vm, instructionStart, fixture), outputVerified: true, output: vm.output.join(''), hostBefore, hostAfter});
    }
  } finally { vm.stop(); }
}

/** Fresh-VM cold work and persistent-VM warm work are distinct distributions, never a claimed speedup. */
export async function measureCompleteWorkload(definition, engine, artifact, options, execution = {}) {
  const {signal, onProgress = () => {}} = execution;
  const {fixture, rowPrefix, minimumCollections = 0} = definition;
  if (!engines.has(engine)) throw new TypeError('Unknown workload latency engine');
  if (![32, 64].includes(options.nativeBits) || !Number.isInteger(options.samples) || options.samples < 1 || options.samples > 1000 ||
      !Number.isInteger(options.warmup) || options.warmup < 1 || options.warmup > 100 ||
      !Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0 || options.timeoutSeconds > 3600) {
    throw new RangeError('Invalid workload latency measurement options');
  }
  abortIfNeeded(signal);
  const deadline = Math.min(performance.now() + options.timeoutSeconds * 1000, execution.deadline ?? Infinity);
  const context = {engine, artifact, options, deadline, signal, fixture};
  const row = {id: rowPrefix + '-' + engine, engine, status: 'running', fixture: fixture.id,
    expectedOutput: fixture.expected,
    sourceSHA256: hash(fixture.source), assemblySHA256: hash(artifact.assembly),
    backend: engine === 'cil' ? 'CilVirtualMachine' : 'VirtualMachine',
    input: engine === 'source' ? 'compiler-source-image' : engine === 'reloaded' ? 'reloaded-compiler-assembly' : 'compiler-CIL',
    vmOptions: workloadLatencyVmOptions(options), cold: [], warm: []};
  onProgress(row);
  try {
    for (let index = 0; index < options.samples; index++) {
      row.cold.push({index, ...(await coldSample(context))});
    }
    await warmSamples(context, row);
    const observations = [...row.cold, ...row.warm];
    if (observations.some(sample => sample.instructions !== row.cold[0].instructions || sample.collections < minimumCollections)) {
      throw new Error('Complete workload instruction count or required guest collections changed');
    }
    row.summary = {cold: summarize(row.cold, ['constructionMs', 'preparationMs', 'executionMs', 'totalMs']),
      warm: summarize(row.warm.filter(sample => sample.phase === 'measured'), ['executionMs'])};
    row.status = 'measured';
    return row;
  } catch (error) {
    row.status = signal?.aborted ? 'cancelled' : 'failed';
    error.evidence = row;
    throw error;
  }
}
