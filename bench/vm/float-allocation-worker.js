import {writeSync} from 'node:fs';
import {floatAllocationCounter, registerFloatAllocationCounter} from './float-allocation-instrumentation.js';

const [mode, iterationsText = '1000000', warmupText = '100000', warmupSlicesText = '1'] = process.argv.slice(2);
const iterations = Number(iterationsText);
const warmup = Number(warmupText);
const warmupSlices = Number(warmupSlicesText);
if (!['typed', 'mixed', 'reference'].includes(mode) || !Number.isInteger(iterations) || iterations < 0 || iterations > 1000000 ||
    !Number.isInteger(warmup) || warmup < 1 || warmup > 100000 || !Number.isInteger(warmupSlices) ||
    warmupSlices < 1 || warmupSlices > Math.min(10000, warmup)) {
  throw new RangeError('Expected typed/mixed/reference, 0..1000000 iterations and 1..100000 warmup iterations');
}
if (typeof globalThis.gc !== 'function') throw new Error('Float qualification requires --expose-gc');
const registration = registerFloatAllocationCounter();
const {CilVirtualMachine, prepareExecution, framePoolStatistics} = await import('@sharpforge/runtime');
const {floatAllocationAssembly, floatLoopInstructions, floatLoopSetupInstructions} = await import('./float-allocation-fixture.js');
const instrumentation = registration.finish();
const total = warmup + Math.max(iterations, 1);
const vm = new CilVirtualMachine(floatAllocationAssembly(total, mode === 'mixed'), {
  typedNumericStack: mode !== 'reference', specializeNumericHandlers: mode === 'mixed',
  maxInstructions: total * floatLoopInstructions + 10
});
const preparation = prepareExecution(vm);
const measureOptions = {instructionBudget: iterations * floatLoopInstructions, timeBudgetMs: Infinity};
let warmedIterations = 0;
for (let index = 0; index < warmupSlices; index++) {
  const next = Math.floor(warmup * (index + 1) / warmupSlices);
  const instructionBudget = (next - warmedIterations) * floatLoopInstructions + (index === 0 ? floatLoopSetupInstructions : 0);
  vm.runSlice({instructionBudget, timeBudgetMs: Infinity});
  warmedIterations = next;
  if (vm.state !== 'running' || vm.instructions !== floatLoopSetupInstructions + warmedIterations * floatLoopInstructions) {
    throw new Error('Float warmup did not stop at its loop boundary');
  }
}
const frame = vm.top;
const instructionsBefore = vm.instructions;
const carriersBefore = floatAllocationCounter.objects;
const managedBefore = vm.heap.stats.allocations;
const framesBefore = framePoolStatistics(vm);
// Warm the fixed marker writes before the collection boundary. No per-iteration host callbacks occur.
writeSync(1, 'A05_FLOAT_TRACE_READY\n');
globalThis.gc();
writeSync(1, 'A05_FLOAT_TRACE_BEGIN\n');
vm.runSlice(measureOptions);
writeSync(1, 'A05_FLOAT_TRACE_END\n');
const carriers = floatAllocationCounter.objects - carriersBefore;
const instructions = vm.instructions - instructionsBefore;
const state = vm.state;
globalThis.gc();
const framesAfter = framePoolStatistics(vm);
const actual = frame.locals[0];
const expected = (warmup + iterations) * 0.25;
const actualNumber = actual?.float ? actual.value : actual;
if (state !== 'running' || instructions !== iterations * floatLoopInstructions || !Object.is(actualNumber, expected)) {
  throw new Error('Float loop state, instruction count or exact result diverged');
}
const inspectionCarriers = floatAllocationCounter.objects - carriersBefore - carriers;
const result = vm.run();
if (result.state !== 'terminated' || !Object.is(result.returnValue, total * 0.25)) throw new Error('Float loop return boundary diverged');
const boundaryCarriers = floatAllocationCounter.objects - carriersBefore - carriers;
const report = {mode, iterations, warmupIterations: warmup, warmupSlices, instructions, floatCarriers: carriers,
  floatCarriersPerIteration: iterations ? carriers / iterations : null, boundaryCarriers, inspectionCarriers,
  returnCarriers: boundaryCarriers - inspectionCarriers, outputVerified: true, expected,
  managedAllocations: vm.heap.stats.allocations - managedBefore,
  framesAllocated: framesAfter.framesAllocated - framesBefore.framesAllocated,
  frameArraysAllocated: framesAfter.arraysAllocated - framesBefore.arraysAllocated,
  instrumentation, preparation, environment: {node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch}};
vm.stop();
writeSync(1, 'A05_FLOAT_RESULT ' + JSON.stringify(report) + '\n');
