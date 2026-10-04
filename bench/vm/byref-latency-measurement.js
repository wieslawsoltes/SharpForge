import {framePoolStatistics, prepareExecution} from '@sharpforge/runtime';
import {assertOutput, createVM, hostMemory, managedMemory, samplePhase, abortIfNeeded} from './operations.js';
import {checkQualificationLimit, runQualificationVM} from './qualification-execution.js';
import {distribution} from './statistics.js';
import {hash} from './evidence.js';
import {byrefLatencyFixture as fixture} from './byref-latency-fixture.js';

const engines = new Set(['source', 'reloaded', 'cil']);
const counterKeys = ['managedAllocations', 'managedAllocatedBytes', 'collections', 'framesAllocated', 'frameArraysAllocated'];

export function byrefLatencyVmOptions(options) {
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
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid byref allocation counter: ' + key);
    return [key, value];
  }));
}

function summarize(samples, timeKeys) {
  return Object.fromEntries([...timeKeys, ...counterKeys].map(key => {
    const summary = distribution(samples.map(sample => sample[key]));
    return [key, {...summary, p50: summary.median}];
  }));
}

function verify(vm, instructionStart) {
  assertOutput(vm, fixture);
  const instructions = vm.instructions - instructionStart;
  if (!Number.isSafeInteger(instructions) || instructions <= 0) throw new Error('Byref workload made no guest progress');
  return instructions;
}

async function coldSample(engine, artifact, options, deadline, signal) {
  checkQualificationLimit(deadline, signal);
  globalThis.gc?.();
  const hostBefore = hostMemory(), started = performance.now();
  let vm;
  try {
    vm = createVM(engine, artifact, byrefLatencyVmOptions(options));
    const constructed = performance.now(), preparation = prepareExecution(vm);
    if (preparation.status !== 'prepared') throw new Error('Byref preparation unavailable: ' + preparation.status);
    const prepared = performance.now(), instructionStart = vm.instructions;
    await runQualificationVM(vm, deadline, signal);
    const finished = performance.now(), after = counters(vm), hostAfter = hostMemory();
    return {constructionMs: constructed - started, preparationMs: prepared - constructed,
      executionMs: finished - prepared, totalMs: finished - started,
      ...delta(after), instructions: verify(vm, instructionStart), outputVerified: true, preparation,
      output: vm.output.join(''), backend: vm.inspector ? 'CilVirtualMachine' : 'VirtualMachine', hostBefore, hostAfter};
  } finally { vm?.stop(); }
}

async function warmSamples(engine, artifact, options, deadline, signal, row) {
  checkQualificationLimit(deadline, signal);
  const vm = createVM(engine, artifact, byrefLatencyVmOptions(options));
  try {
    const entry = vm.inspector ? vm.top.method.token : vm.top.methodId;
    row.warmPreparation = prepareExecution(vm);
    if (row.warmPreparation.status !== 'prepared') throw new Error('Byref warm preparation unavailable');
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
        instructions: verify(vm, instructionStart), outputVerified: true, output: vm.output.join(''), hostBefore, hostAfter});
    }
  } finally { vm.stop(); }
}

/** Fresh-VM cold work and persistent-VM warm work are distinct distributions, never a claimed speedup. */
export async function measureByrefLatency(engine, artifact, options, signal, onProgress = () => {}) {
  if (!engines.has(engine)) throw new TypeError('Unknown byref latency engine');
  if (![32, 64].includes(options.nativeBits) || !Number.isInteger(options.samples) || options.samples < 1 || options.samples > 1000 ||
      !Number.isInteger(options.warmup) || options.warmup < 1 || options.warmup > 100 ||
      !Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0 || options.timeoutSeconds > 3600) {
    throw new RangeError('Invalid byref latency measurement options');
  }
  abortIfNeeded(signal);
  const deadline = performance.now() + options.timeoutSeconds * 1000;
  const row = {id: 'byref-latency-' + engine, engine, status: 'running', fixture: fixture.id,
    expectedOutput: fixture.expected,
    sourceSHA256: hash(fixture.source), assemblySHA256: hash(artifact.assembly),
    backend: engine === 'cil' ? 'CilVirtualMachine' : 'VirtualMachine',
    input: engine === 'source' ? 'compiler-source-image' : engine === 'reloaded' ? 'reloaded-compiler-assembly' : 'compiler-CIL',
    vmOptions: byrefLatencyVmOptions(options), cold: [], warm: []};
  onProgress(row);
  try {
    for (let index = 0; index < options.samples; index++) {
      row.cold.push({index, ...(await coldSample(engine, artifact, options, deadline, signal))});
    }
    await warmSamples(engine, artifact, options, deadline, signal, row);
    const observations = [...row.cold, ...row.warm];
    if (observations.some(sample => sample.instructions !== row.cold[0].instructions || sample.collections < 4)) {
      throw new Error('Byref workload instruction count or four explicit collections changed');
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
