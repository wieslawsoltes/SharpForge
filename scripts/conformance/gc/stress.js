import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {compile, compileToIL} from '@sharpforge/compiler';
import {ManagedHeap, VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {isMain} from '../../planning/test-manifests.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
export const cases = [
  {id: 'roots', output: 'root\nleaf\n'}, {id: 'arrays', output: 'value0\nvalue15\n0\n'},
  {id: 'large-object', output: '90000\n95\n'}, {id: 'allocation-limit', fault: 'OutOfMemoryException'},
  {id: 'exception-root', output: 'retained-fault\n'},
];
export const unsupported = [
  {feature: 'byte-array-execution', reason: 'The selected compiler profile rejects small integer arrays with SF2200; the large allocation fixture uses Int32 elements.'},
  {feature: 'rust-collector', reason: 'No Rust collector adapter exists.'},
  {feature: 'managed-weak-reference', reason: 'No qualified System.WeakReference implementation; host weak handles are tested separately.'},
  {feature: 'resurrection', reason: 'No GC finalizer queue or resurrection API exists.'},
  {feature: 'finalizer-order', reason: 'C# finally handlers do not implement GC finalization.'},
  {feature: 'large-object-generations', reason: 'The JS heap is non-generational; a large allocation does not qualify CoreCLR LOH semantics.'},
];
let active = false;
/** Isolated synchronous harness only. Restore the production prototype in all paths. */
export function withAllocationStress(action) {
  if (active) throw new Error('GC stress harness cannot overlap or nest');
  active = true; const reserve = ManagedHeap.prototype.reserve;
  const counts = new WeakMap();
  ManagedHeap.prototype.reserve = function(bytes, roots = []) {
    const pinned = [...roots]; this.collect(pinned);
    counts.set(this, (counts.get(this) ?? 0) + 1);
    return reserve.call(this, bytes, pinned);
  };
  try { const value = action(heap => counts.get(heap) ?? 0); if (value?.then) throw new Error('GC stress action must be synchronous'); return value; }
  finally { ManagedHeap.prototype.reserve = reserve; active = false; }
}
export function runStressProgram(source, {engine = 'source', maxBytes = 4 * 1024 * 1024} = {}) {
  if (!['source', 'cil'].includes(engine)) throw new Error('Unsupported VM: ' + engine);
  const compilation = (engine === 'source' ? compile : compileToIL)(source);
  if (!compilation.success) return {status: 'compile-failed', diagnostics: compilation.diagnostics};
  return withAllocationStress(count => {
    let vm;
    try {
      vm = engine === 'source' ? new VirtualMachine(compilation.image, {maxBytes, maxInstructions: 500000})
        : new CilVirtualMachine(compilation.assembly, {maxBytes, maxInstructions: 500000});
      const result = vm.run();
      return {status: result.state, output: result.output, fault: result.fault?.name ?? result.fault?.type ?? null,
        stressCollections: count(vm.heap), allocations: vm.heap.stats.allocations, collections: vm.heap.stats.collections};
    } finally { vm?.stop(); }
  });
}
export async function runStressSuite({output = 'artifacts/gc-stress/report.json'} = {}) {
  const report = {schemaVersion: 1, platform: `${process.platform}-${process.arch}`, node: process.versions.node,
    mode: 'collect-before-every-reservation-including-construction', cases: [], unsupported, qualification: 'unknown'};
  for (const fixture of cases) {
    const source = await readFile(resolve(root, `tests/conformance/gc/stress/programs/${fixture.id}.cs`), 'utf8');
    for (const engine of ['source', 'cil']) {
      let actual; try { actual = runStressProgram(source, {engine}); } catch (error) { actual = {status: 'harness-failed', error: error.message}; }
      const passed = fixture.fault ? actual.status === 'faulted' && actual.fault === fixture.fault
        : actual.status === 'terminated' && actual.output === fixture.output;
      report.cases.push({id: fixture.id, engine, ...actual, passed: passed && actual.stressCollections > 0 && actual.stressCollections >= actual.allocations});
    }
  }
  report.status = report.cases.every(row => row.passed) ? 'passed-supported-cases' : 'failed';
  const path = resolve(output); await mkdir(dirname(path), {recursive: true}); await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (isMain(import.meta.url)) {
  const {values} = parseArgs({options: {output: {type: 'string'}}}); const report = await runStressSuite(values);
  console.log(JSON.stringify({status: report.status, cases: report.cases.length, unsupported: unsupported.length}));
  if (report.status === 'failed') process.exitCode = 1;
}
