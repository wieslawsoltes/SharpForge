import {CilVirtualMachine, wasmTieringStatistics, disposeWasmTiering} from '@sharpforge/runtime';
import {qualificationAssembly} from './qualification-assembly.js';
import {qualificationVmOptions, checkQualificationLimit, runQualificationVM} from './qualification-execution.js';
import {abortIfNeeded, hostMemory} from './operations.js';
import {distribution} from './statistics.js';
import {hash} from './evidence.js';

const acceptanceIterations = 1000000;
const requestedSliceMs = 8;
const requestedInstructionBudget = 10000;
const compilationTriggerInstructions = 16;
const yieldHost = () => new Promise(resolve => setImmediate(resolve));

function loopAssembly(iterations) {
  return qualificationAssembly({name: 'TieredFairness', locals: ['int'], body(writer) {
    writer.op('ldc.i4.0').op('stloc.0').mark('loop');
    writer.op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0');
    writer.op('ldloc.0').integer(iterations).op('blt', 'loop');
    writer.op('ldloc.0').op('ret');
  }});
}

function requireOptions(options, iterations, signal) {
  abortIfNeeded(signal);
  if (!Number.isInteger(iterations) || iterations < 32 || iterations > acceptanceIterations) {
    throw new RangeError('Tiered fairness iterations must be 32–1000000');
  }
  if (![32, 64].includes(options.nativeBits) || !Number.isFinite(options.timeoutSeconds) ||
      options.timeoutSeconds <= 0 || options.timeoutSeconds > 3600) {
    throw new RangeError('Invalid tiered fairness ABI or time limit');
  }
}

async function interpreterReference(assembly, options, deadline, signal) {
  const vm = new CilVirtualMachine(assembly, qualificationVmOptions(options));
  try {
    await runQualificationVM(vm, deadline, signal);
    return {returnValue: vm.returnValue, instructions: vm.instructions, wasmTiering: wasmTieringStatistics(vm)};
  } finally { vm.stop(); }
}

function observeSlice(vm, row, phase, instructionBudget = requestedInstructionBudget) {
  if (row.slices.length >= 10000) throw new Error('Tiered fairness exceeded its 10000-slice evidence limit');
  const tierBefore = wasmTieringStatistics(vm);
  const hostBefore = hostMemory();
  const instructionsBefore = vm.instructions;
  const started = performance.now();
  vm.runSlice({instructionBudget, timeBudgetMs: requestedSliceMs});
  const durationMs = performance.now() - started;
  const tierAfter = wasmTieringStatistics(vm);
  const instructions = vm.instructions - instructionsBefore;
  row.slices.push({index: row.slices.length, phase, durationMs, instructionBudget, instructions,
    selectedInstructions: tierAfter.selectedInstructions - tierBefore.selectedInstructions,
    osrTransitions: tierAfter.osrTransitions - tierBefore.osrTransitions, hostBefore, hostAfter: hostMemory()});
  if (!Number.isFinite(durationMs) || durationMs <= 0 || instructions < 1 || instructions > instructionBudget) {
    throw new Error('Tiered fairness observed invalid timing, no progress, or an exceeded instruction budget');
  }
  if (vm.fault || vm.pendingFault || !['running', 'terminated'].includes(vm.state)) {
    throw new Error('Tiered fairness guest stopped unexpectedly: ' + (vm.fault?.message ?? vm.state));
  }
}

async function awaitCompilation(vm, row, deadline, signal) {
  const started = performance.now();
  for (;;) {
    checkQualificationLimit(deadline, signal);
    const tier = wasmTieringStatistics(vm);
    const method = tier.methods[0];
    if (method?.status === 'ready') {
      row.compilationWaitMs = performance.now() - started;
      row.tierBeforeExecution = tier;
      return;
    }
    if (!tier.enabled || tier.invalidated || method?.status === 'fallback') {
      throw new Error('Tiered fairness requires actual compiled Wasm: ' + (method?.reason?.message ?? method?.status ?? 'disabled'));
    }
    await yieldHost();
  }
}

function verifyExecution(vm, row, iterations) {
  const expectedInstructions = 7 * iterations + 4;
  row.returnValue = vm.returnValue;
  row.instructions = vm.instructions;
  row.tierAfterExecution = wasmTieringStatistics(vm);
  row.timedInstructions = row.slices.reduce((total, slice) => total + slice.instructions, 0);
  row.selectedInstructions = row.slices.reduce((total, slice) => total + slice.selectedInstructions, 0);
  if (vm.state !== 'terminated' || vm.returnValue !== iterations || row.reference.returnValue !== iterations ||
      vm.instructions !== expectedInstructions || row.reference.instructions !== expectedInstructions ||
      row.timedInstructions !== expectedInstructions) {
    throw new Error('Tiered fairness result or exact guest instruction count differs from its interpreter reference');
  }
  if (row.tierAfterExecution.osrTransitions !== 1 || row.selectedInstructions <= 0 ||
      row.selectedInstructions !== row.tierAfterExecution.selectedInstructions ||
      row.slices.reduce((total, slice) => total + slice.osrTransitions, 0) !== 1) {
    throw new Error('Tiered fairness executed no verified Wasm OSR selection');
  }
  row.outputVerified = true;
  row.summary = {sliceMs: distribution(row.slices.map(slice => slice.durationMs))};
  row.target = {kind: 'maximum-observed-slice', value: 2 * requestedSliceMs, unit: 'milliseconds',
    observed: row.summary.sliceMs.maximum, requiredIterations: acceptanceIterations,
    meetsAcceptanceSize: iterations === acceptanceIterations,
    acceptance: iterations < acceptanceIterations ? 'partial' : row.summary.sliceMs.maximum <= 2 * requestedSliceMs ? 'met' : 'missed'};
  row.status = 'measured';
}

/** Time every candidate slice, including OSR entry; compilation waits and the full interpreter oracle are outside slice timers. */
export async function measureTieredFairness(options, signal, iterations = acceptanceIterations) {
  requireOptions(options, iterations, signal);
  const deadline = performance.now() + options.timeoutSeconds * 1000;
  const assembly = loopAssembly(iterations);
  const vmOptions = {...qualificationVmOptions(options),
    wasmTiering: {callThreshold: 10000, backedgeThreshold: 2, osr: true}};
  const row = {id: 'tiered-loop-fairness-cil', issue: 727, engine: 'cil', tier: 'wasm-osr', iterations,
    status: 'running', assemblyHash: hash(assembly), vmOptions, requestedSliceMs, requestedInstructionBudget, slices: [],
    measurement: 'One counter loop; every candidate runSlice from entry through return is timed, including the OSR transition.',
    preparation: 'After two interpreted backedges, await actual async Wasm compilation without executing guest instructions.',
    comparison: 'The same complete assembly executes with tiering disabled outside the candidate slice timers.'};
  let vm;
  try {
    row.reference = await interpreterReference(assembly, options, deadline, signal);
    checkQualificationLimit(deadline, signal);
    vm = new CilVirtualMachine(assembly, vmOptions);
    globalThis.gc?.();
    observeSlice(vm, row, 'compilation-trigger', compilationTriggerInstructions);
    if (vm.instructions !== compilationTriggerInstructions || wasmTieringStatistics(vm).methods[0]?.backedges !== 2) {
      throw new Error('Tiered fairness did not reach its exact compilation boundary');
    }
    await awaitCompilation(vm, row, deadline, signal);
    const started = performance.now();
    while (vm.state === 'running') {
      checkQualificationLimit(deadline, signal);
      observeSlice(vm, row, 'tiered-execution');
      if (vm.state === 'running') await yieldHost();
    }
    row.executionWallMs = performance.now() - started;
    checkQualificationLimit(deadline, signal);
    verifyExecution(vm, row, iterations);
    return row;
  } catch (error) {
    row.status = signal?.aborted ? 'cancelled' : 'failed';
    error.evidence = row;
    throw error;
  } finally {
    if (vm) {
      disposeWasmTiering(vm);
      vm.stop();
      row.disposal = {state: vm.state, activeFrames: vm.frames.length, tierEnabled: wasmTieringStatistics(vm).enabled};
    }
  }
}
