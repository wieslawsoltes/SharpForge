// node scripts/benchmarks/a05-call-offsets.mjs /path/to/baseline/worktree
// Same process/runner, interleaved samples; allocation counting is outside timings.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {strict as assert} from 'node:assert';

if (!process.argv[2]) throw new Error('Provide the unmodified baseline worktree path');
const baselineRoot = resolve(process.argv[2]);
const {CilVirtualMachine: BaselineVM} = await import(pathToFileURL(resolve(baselineRoot, 'packages/runtime/src/index.js')));
const source = 'class P { static int Fib(int n) { if(n<2)return n;return Fib(n-1)+Fib(n-2); } static int Main(){return Fib(25);} }';
const compiled = compileToIL(source);
assert(compiled.success, JSON.stringify(compiled.diagnostics));
const implementations = {baseline: BaselineVM, candidate: CilVirtualMachine};
const results = {};
const run = VM => {
  const vm = new VM(compiled.assembly), started = performance.now();
  const result = vm.run(), elapsed = performance.now() - started;
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.returnValue, 75025);
  return elapsed;
};
for (const [name, VM] of Object.entries(implementations)) {
  results[name] = {coldMs: run(VM), samplesMs: []};
  run(VM);
}
for (let sample = 0; sample < 7; sample++) {
  const order = sample % 2 ? Object.entries(implementations).reverse() : Object.entries(implementations);
  for (const [name, VM] of order) results[name].samplesMs.push(run(VM));
}
const NativeMap = globalThis.Map;
for (const [name, VM] of Object.entries(implementations)) {
  let allocations = 0, calls = 0;
  const vm = new VM(compiled.assembly), originalCall = vm.call;
  vm.call = function(...args) { calls++; return originalCall.apply(this, args); };
  try {
    globalThis.Map = class CountedMap extends NativeMap { constructor(...args) { super(...args); allocations++; } };
    assert.equal(vm.run().returnValue, 75025);
  } finally { globalThis.Map = NativeMap; }
  const sorted = [...results[name].samplesMs].sort((a, b) => a - b);
  Object.assign(results[name], {medianMs: sorted[3], p95Ms: sorted[6], p99Ms: sorted[6], calls, mapAllocations: allocations, mapsPerCall: allocations / calls});
}
assert(results.candidate.mapAllocations < results.baseline.mapAllocations, 'Call map allocations did not decrease');
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, workload: 'fib(25)', samples: 7, baselineRoot, results, medianSpeedup: results.baseline.medianMs / results.candidate.medianMs}, null, 2));
