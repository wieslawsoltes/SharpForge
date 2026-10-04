import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, prepareExecution} from '@sharpforge/runtime';
import {virtualAssembly} from './virtual.js';

export function compileFixture(fixture) {
  if (fixture.virtual) return {assembly: virtualAssembly(fixture.iterations), image: null};
  const result = compileToIL(fixture.source, {name: 'Bench_' + fixture.id});
  if (!result.success) throw new Error(`${fixture.id}: compilation failed: ${JSON.stringify(result.diagnostics)}`);
  return {assembly: result.assembly, image: result.image};
}

export function createVM(engine, artifact, options) {
  if (engine === 'cil') return new CilVirtualMachine(artifact.assembly, options);
  if (!['source', 'reloaded'].includes(engine)) throw new TypeError('Unknown execution engine: ' + engine);
  return new VirtualMachine(engine === 'source' ? artifact.image : loadAssembly(artifact.assembly), options);
}

export function assertOutput(vm, fixture) {
  const returnValue = vm instanceof CilVirtualMachine ? vm.resultValue() : vm.value(vm.returnValue);
  const output = vm.output.join('');
  if (vm.state !== 'terminated' || vm.fault || vm.pendingFault ||
      fixture.expected !== undefined && output !== fixture.expected ||
      fixture.expectedReturn !== undefined && returnValue !== fixture.expectedReturn) {
    const details = {state: vm.state, output, expected: fixture.expected,
      returnValue: String(returnValue), fault: vm.fault?.message};
    throw new Error(`${fixture.id}: incorrect result ${JSON.stringify(details)}`);
  }
}

export function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Benchmark cancelled', 'AbortError');
}

export async function runVM(vm, signal) {
  while (['ready', 'running', 'paused'].includes(vm.state)) {
    abortIfNeeded(signal);
    if (vm.state === 'paused') throw new Error('Unexpected debugger pause');
    vm.runSlice({instructionBudget: 10000, timeBudgetMs: 8});
    if (vm.state === 'paused') throw new Error('Unexpected debugger pause');
    if (vm.state === 'running') await new Promise(resolve => setImmediate(resolve));
  }
  abortIfNeeded(signal);
  if (vm.state === 'waiting') throw new Error('Synchronous benchmark unexpectedly waited on external work');
}

/** Source restore intentionally pauses for its debugger; explicitly resume only this known replay boundary. */
export function resumeReplay(vm) {
  if (vm instanceof VirtualMachine && vm.state === 'paused') vm.state = 'running';
}

export function restoreForReplay(vm, snapshot) {
  vm.restore(snapshot);
  resumeReplay(vm);
}

export async function withVM(create, operation) {
  const vm = create();
  try { return await operation(vm); }
  finally { vm.stop(); }
}

export function hostMemory() {
  const {rss, heapUsed, heapTotal, external, arrayBuffers} = process.memoryUsage();
  return {rss, heapUsed, heapTotal, external, arrayBuffers};
}

export function managedMemory(vm) {
  return {allocations: vm.heap.stats.allocations, allocatedBytes: vm.heap.stats.allocatedBytes};
}

export function samplePhase(index, warmup) {
  return index === 0 ? 'first' : index <= warmup ? 'warmup' : 'measured';
}

export async function executionSample(vm, fixture, signal) {
  abortIfNeeded(signal);
  const hostBefore = hostMemory();
  const before = managedMemory(vm);
  const instructions = vm.instructions;
  const start = performance.now();
  await runVM(vm, signal);
  const executionMs = performance.now() - start;
  const hostAfter = hostMemory();
  const after = managedMemory(vm);
  assertOutput(vm, fixture);
  const count = vm.instructions - instructions;
  if (!(executionMs > 0 && count > 0)) throw new Error('Execution did not produce a measurable interval/instruction count');
  return {executionMs, instructions: count, instructionsPerSecond: count * 1000 / executionMs,
    managedAllocations: after.allocations - before.allocations, managedAllocatedBytes: after.allocatedBytes - before.allocatedBytes,
    hostBefore, hostAfter, outputVerified: true};
}

export function prepareWarmVM(vm, signal) {
  abortIfNeeded(signal);
  const preparation = prepareExecution(vm);
  if (!['prepared', 'not-required'].includes(preparation.status)) {
    throw new Error('Benchmark preparation unavailable: ' + preparation.reason);
  }
  return {snapshot: vm.snapshot(), preparation};
}
