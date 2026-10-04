import {CilVirtualMachine, wasmTieringStatistics, disposeWasmTiering,
  framePoolStatistics, executionCodeStatistics} from '@sharpforge/runtime';
import {qualificationVmOptions, checkQualificationLimit, runQualificationVM} from './qualification-execution.js';
import {requireQualificationOptions} from './qualification-options.js';
import {managedMemory, hostMemory, samplePhase} from './operations.js';
import {distribution} from './statistics.js';
import {hash} from './evidence.js';

const allocationKeys = ['managedAllocations', 'managedAllocatedBytes', 'framesAllocated', 'frameArraysAllocated', 'offsetMapAllocations'];
const yieldHost = () => new Promise(resolve => setImmediate(resolve));

function counters(vm) {
  const managed = managedMemory(vm), frames = framePoolStatistics(vm), code = executionCodeStatistics(vm);
  return {managedAllocations: managed.allocations, managedAllocatedBytes: managed.allocatedBytes,
    framesAllocated: frames.framesAllocated, frameArraysAllocated: frames.arraysAllocated,
    offsetMapAllocations: code.offsetMapAllocations, tier: wasmTieringStatistics(vm)};
}

function allocations(before, after) {
  return Object.fromEntries(allocationKeys.map(key => {
    const value = after[key] - (before?.[key] ?? 0);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Wasm allocation counter: ' + key);
    return [key, value];
  }));
}

function verifyResult(vm, fixture, sample) {
  sample.returnValue = vm.resultValue();
  sample.output = vm.output.join('');
  if (vm.state !== 'terminated' || vm.fault || vm.pendingFault || sample.returnValue !== fixture.expectedReturn ||
      sample.output !== fixture.expectedOutput || sample.instructions !== fixture.expectedInstructions ||
      sample.managedAllocations !== fixture.expectedManagedAllocations) {
    throw new Error(fixture.id + ': output, instruction or managed-allocation mismatch');
  }
  sample.outputVerified = true;
}

async function awaitReady(vm, deadline, signal) {
  for (;;) {
    checkQualificationLimit(deadline, signal);
    const tier = wasmTieringStatistics(vm), method = tier?.methods[0];
    if (method?.status === 'ready' && tier.activeCompilations === 0) {
      if (!tier.enabled || tier.invalidated || tier.compilationAttempts !== 1 || tier.methods.length !== 1 ||
          tier.compiledBytes <= 0 || method.bytes !== tier.compiledBytes || vm.instructions !== 0) {
        throw new Error('Wasm cold preparation changed guest execution or did not produce one ready method');
      }
      return tier;
    }
    if (!tier?.enabled || tier.invalidated || method?.status === 'fallback') {
      throw new Error('Actual Wasm compilation required: ' + (method?.reason?.message ?? method?.status ?? 'disabled'));
    }
    await yieldHost();
  }
}

function dispose(context) {
  if (!context?.vm) return;
  disposeWasmTiering(context.vm);
  context.vm.stop();
  context.disposal = {state: context.vm.state, frames: context.vm.frames.length, tier: wasmTieringStatistics(context.vm)};
}

async function coldContext(fixture, vmOptions, deadline, signal, sample) {
  checkQualificationLimit(deadline, signal);
  globalThis.gc?.();
  sample.hostBefore = hostMemory();
  const started = performance.now(), context = {};
  try {
    context.vm = new CilVirtualMachine(fixture.assembly, vmOptions);
    const constructed = performance.now();
    sample.constructionMs = constructed - started;
    sample.tier = await awaitReady(context.vm, deadline, signal);
    const ready = performance.now();
    sample.preparationMs = ready - constructed;
    sample.coldReadyMs = ready - started;
    sample.hostAfter = hostMemory();
    Object.assign(sample, allocations(null, counters(context.vm)));
    sample.instructions = context.vm.instructions;
    sample.compiledBytes = sample.tier.compiledBytes;
    context.entry = context.vm.top.method.token;
    return context;
  } catch (error) {
    dispose(context);
    sample.disposal = context.disposal;
    throw error;
  }
}

async function observe(context, fixture, deadline, signal, compiled) {
  const {vm} = context;
  checkQualificationLimit(deadline, signal);
  if (compiled) {
    if (vm.state !== 'terminated' || vm.frames.length) throw new Error('Compiled reentry requires a completed prior execution');
    vm.output.length = 0;
    vm.outputCharacters = 0;
    vm.returnValue = null;
  }
  globalThis.gc?.();
  const before = counters(vm), hostBefore = hostMemory(), instructionStart = vm.instructions;
  const started = performance.now();
  if (compiled) {
    vm.state = 'running';
    vm.call(context.entry, []);
  }
  await runQualificationVM(vm, deadline, signal);
  const executionMs = performance.now() - started, hostAfter = hostMemory(), after = counters(vm);
  if (!Number.isFinite(executionMs) || executionMs <= 0) throw new Error('Wasm latency observed no measurable execution');
  const sample = {executionMs, instructions: vm.instructions - instructionStart, hostBefore, hostAfter,
    ...allocations(before, after), tierBefore: before.tier, tierAfter: after.tier};
  verifyResult(vm, fixture, sample);
  const selectedInstructions = (after.tier?.selectedInstructions ?? 0) - (before.tier?.selectedInstructions ?? 0);
  const selectedCalls = (after.tier?.selectedCalls ?? 0) - (before.tier?.selectedCalls ?? 0);
  if (selectedInstructions !== (compiled ? sample.instructions : 0) || selectedCalls !== Number(compiled)) {
    throw new Error('Wasm backend selection differs from the complete requested execution');
  }
  if (compiled && (after.tier.compilationAttempts !== before.tier.compilationAttempts ||
      after.tier.compiledBytes !== before.tier.compiledBytes || after.tier.osrTransitions !== 0)) {
    throw new Error('A warm compiled observation recompiled or changed its entry backend');
  }
  sample.selectedInstructions = selectedInstructions;
  sample.selectedCalls = selectedCalls;
  return sample;
}

async function interpreterReference(fixture, options, deadline, signal) {
  const context = {vm: new CilVirtualMachine(fixture.assembly, qualificationVmOptions(options))};
  try { return await observe(context, fixture, deadline, signal, false); }
  finally { context.vm.stop(); }
}

async function proveNativeArithmetic(context, fixture, deadline, signal) {
  const {vm} = context, descriptor = Object.getOwnPropertyDescriptor(vm, 'binary');
  vm.binary = () => { throw new Error('Wasm arithmetic fell back to the interpreter'); };
  try {
    const observed = await observe(context, fixture, deadline, signal, true);
    return {method: 'An untimed complete compiled execution rejects every interpreter binary operation.',
      selectedInstructions: observed.selectedInstructions, instructions: observed.instructions, outputVerified: observed.outputVerified};
  } finally {
    if (descriptor) Object.defineProperty(vm, 'binary', descriptor);
    else delete vm.binary;
  }
}

function summarize(samples, timeKeys) {
  const measured = samples.filter(sample => sample.phase === 'measured');
  return Object.fromEntries([...timeKeys, ...allocationKeys].map(key => {
    const summary = distribution(measured.map(sample => sample[key]));
    return [key, {...summary, p50: summary.median}];
  }));
}

/** Each cold sample owns a fresh VM; warm complete calls retain one ready method without restore or invalidation. */
export async function measureWasmLatency(fixture, options, signal, onProgress = () => {}) {
  requireQualificationOptions(options);
  const deadline = performance.now() + options.timeoutSeconds * 1000;
  const vmOptions = {...qualificationVmOptions(options), wasmTiering: {callThreshold: 1, osr: false}};
  const row = {id: fixture.id, issue: 84, engine: 'cil', backend: 'node-webassembly-call-entry', status: 'running',
    iterations: fixture.iterations, assemblyHash: hash(fixture.assembly), vmOptions,
    samples: {cold: [], interpretedPriming: [], firstCompiled: [], warmCompiled: []}, disposals: []};
  let context;
  try {
    checkQualificationLimit(deadline, signal);
    row.reference = await interpreterReference(fixture, options, deadline, signal);
    const count = options.samples + options.warmup + 1;
    for (let index = 0; index < count; index++) {
      const phase = samplePhase(index, options.warmup), cold = {index, phase};
      row.samples.cold.push(cold);
      context = await coldContext(fixture, vmOptions, deadline, signal, cold);
      row.samples.interpretedPriming.push({index, phase, ...await observe(context, fixture, deadline, signal, false)});
      const first = await observe(context, fixture, deadline, signal, true);
      if (first.managedAllocatedBytes !== row.reference.managedAllocatedBytes) {
        throw new Error('First compiled allocation bytes differ from the interpreter oracle');
      }
      row.samples.firstCompiled.push({index, phase, ...first});
      if (index + 1 < count) {
        dispose(context);
        row.disposals.push({index, ...context.disposal});
        context = null;
      }
      onProgress(row);
    }
    row.backendProof = await proveNativeArithmetic(context, fixture, deadline, signal);
    for (let index = 0; index < count; index++) {
      const sample = await observe(context, fixture, deadline, signal, true);
      if (sample.managedAllocatedBytes !== row.reference.managedAllocatedBytes) {
        throw new Error('Compiled managed allocation bytes differ from the interpreter oracle');
      }
      row.samples.warmCompiled.push({index, phase: samplePhase(index, options.warmup), ...sample});
      onProgress(row);
    }
    row.summary = {cold: summarize(row.samples.cold, ['constructionMs', 'preparationMs', 'coldReadyMs']),
      firstCompiled: summarize(row.samples.firstCompiled, ['executionMs']),
      warmCompiled: summarize(row.samples.warmCompiled, ['executionMs'])};
    row.outputVerified = true;
    row.status = 'measured';
    return row;
  } catch (error) {
    row.status = signal?.aborted ? 'cancelled' : 'failed';
    error.evidence = row;
    throw error;
  } finally {
    if (context) {
      dispose(context);
      row.disposals.push({index: row.samples.cold.length - 1, ...context.disposal});
    }
  }
}
