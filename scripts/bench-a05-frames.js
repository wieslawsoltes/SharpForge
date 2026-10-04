import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {framePoolStatistics} from '../packages/runtime/src/execution/frame-pool.js';
import {visitVMRoots} from '../packages/runtime/src/execution/frame-roots.js';

const source = `class Program {
  static int Sum(int depth) { if(depth == 0) return 0; return depth + Sum(depth - 1); }
  static void Main() { System.Console.WriteLine(Sum(500)); }
}`;
const compiled = compileToIL(source);
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
const quantile = (values, fraction) => values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
function measure(action, count = 100) {
  const times = [];
  for (let index = 0; index < count; index++) {
    const start = performance.now();
    action();
    times.push(performance.now() - start);
  }
  times.sort((left, right) => left - right);
  return {medianMs: quantile(times, 0.5), p95Ms: quantile(times, 0.95), p99Ms: quantile(times, 0.99)};
}

function latency(engine) {
  const start = performance.now();
  const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
  const cold = vm.run();
  if (cold.state !== 'terminated' || cold.output !== '125250\n') throw cold.fault ?? new Error('Recursive output mismatch');
  const coldMs = performance.now() - start, before = framePoolStatistics(vm);
  const warm = measure(() => {
    vm.call(engine === 'source' ? compiled.image.entryPoint : vm.report.entryPoint, []);
    vm.state = 'ready';
    vm.run();
  }, 30);
  const after = framePoolStatistics(vm);
  vm.heap.collect();
  return {coldMs, warm, allocations: {cold: before, warmFrames: after.framesAllocated - before.framesAllocated,
    warmArrays: after.arraysAllocated - before.arraysAllocated}, afterUnwind: {liveObjects: vm.heap.stats.liveObjects,
    retainedPoolBytes: after.retainedBytes}};
}

const vm = new CilVirtualMachine(compiled.assembly);
vm.runSlice({instructionBudget: 100000, timeBudgetMs: 10000,
  onInstruction: () => vm.frames.length >= 500});
if (vm.frames.length < 500) throw new Error('Benchmark did not retain 500 real managed frames');
let count = 0;
const visit = () => { count++; };
visitVMRoots(vm, visit); // Exclude cold metadata/liveness analysis from both warm root scans.
const generator = measure(() => { for (const value of vm.roots()) if (value !== undefined) count++; }, 1000);
const visitor = measure(() => visitVMRoots(vm, visit), 1000);
const ratio = generator.medianMs / visitor.medianMs;
console.log(JSON.stringify({runtime: process.version, platform: process.platform, arch: process.arch,
  source: latency('source'), cil: latency('cil'), roots: {frames: vm.frames.length, generator, visitor,
    ratio, meetsThreeTimesTarget: ratio >= 3, visited: count}}, null, 2));
