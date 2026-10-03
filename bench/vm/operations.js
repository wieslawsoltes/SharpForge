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
  return new VirtualMachine(engine === 'source' ? artifact.image : loadAssembly(artifact.assembly), options);
}
export function assertOutput(vm, fixture) {
  const result = {state: vm.state, output: vm.output.join(''), returnValue: vm.returnValue, fault: vm.fault};
  if (result.state !== 'terminated' || fixture.expected !== undefined && result.output !== fixture.expected ||
      fixture.expectedReturn !== undefined && result.returnValue !== fixture.expectedReturn) {
    throw new Error(`${fixture.id}: incorrect result ${JSON.stringify({state: result.state, output: result.output,
      expected: fixture.expected, returnValue: result.returnValue, fault: result.fault?.message})}`);
  }
}
export function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Benchmark cancelled', 'AbortError');
}
export async function runVM(vm, signal) {
  while (['ready', 'running', 'paused'].includes(vm.state)) {
    abortIfNeeded(signal);
    vm.runSlice({instructionBudget: 10000, timeBudgetMs: 8});
    if (vm.state === 'paused') throw new Error('Unexpected debugger pause');
    if (vm.state === 'running') await new Promise(resolve => setImmediate(resolve));
  }
  if (vm.state === 'waiting') throw new Error('Synchronous benchmark unexpectedly waited on external work');
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
export function samplePhase(index, warmup) { return index === 0 ? 'first' : index <= warmup ? 'warmup' : 'measured'; }

export async function executionSample(vm, fixture, signal) {
  abortIfNeeded(signal);
  const hostBefore = hostMemory(), before = managedMemory(vm), instructions = vm.instructions;
  const start = performance.now();
  await runVM(vm, signal);
  const executionMs = performance.now() - start, hostAfter = hostMemory(), after = managedMemory(vm);
  assertOutput(vm, fixture);
  const count = vm.instructions - instructions;
  if (!(executionMs > 0 && count > 0)) throw new Error('Execution did not produce a measurable interval/instruction count');
  return {executionMs, instructions: count, instructionsPerSecond: count * 1000 / executionMs,
    managedAllocations: after.allocations - before.allocations, managedAllocatedBytes: after.allocatedBytes - before.allocatedBytes,
    hostBefore, hostAfter, outputVerified: true};
}
export async function prepareWarmVM(vm, fixture, signal) {
  const preparation = prepareExecution(vm);
  if (preparation.status !== 'prepared') throw new Error('Benchmark preparation is unsupported: ' + preparation.reason);
  return vm.snapshot();
}
