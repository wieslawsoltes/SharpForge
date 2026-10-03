import { compile, compileToIL } from '../../../packages/compiler/src/index.js';
import { VirtualMachine, CilVirtualMachine } from '../../../packages/runtime/src/index.js';

export const runtimeSource = fixture => `using System; ${fixture.declarations ?? ''} class Program { static void Main() { ${fixture.body} } }`;
export async function executeProbe(fixture, engine, { signal, maxInstructions = 200000 } = {}) {
  const source = runtimeSource(fixture), started = performance.now(); let vm;
  try {
    const compilation = engine === 'js-cil-vm' ? compileToIL(source) : compile(source);
    if (!compilation.success) return { status: 'fail', phase: 'compile', diagnostics: compilation.diagnostics.map(d=>({code:d.code,message:d.message})) };
    vm = engine === 'js-cil-vm' ? new CilVirtualMachine(compilation.assembly, { virtualTime: true, maxInstructions }) : new VirtualMachine(compilation.image, { virtualTime: true, maxInstructions });
    let slices = 0;
    const local = new AbortController(), timer = setTimeout(()=>local.abort(), 5000);
    const combined = signal ? AbortSignal.any([signal, local.signal]) : local.signal;
    try { await vm.runAsync({ signal: combined, onSlice() { if (++slices > 1000 || vm.instructions > maxInstructions) local.abort(); } }); }
    finally { clearTimeout(timer); }
    const output = vm.output.join(''), pass = vm.state === 'terminated' && !vm.fault && vm.exitCode === 0 && output === fixture.stdout;
    return { status: pass ? 'pass' : 'fail', phase: 'execute', state: vm.state, output, expected: fixture.stdout, exitCode: vm.exitCode,
      fault: vm.fault && { name: vm.fault.name, message: vm.fault.message }, elapsedMs: performance.now()-started,
      managedAllocations: { allocatedBytes: vm.heap.stats.allocatedBytes, allocations: vm.heap.stats.allocations, model: 'SharpForge managed heap accounting; excludes JavaScript/native allocations' } };
  } catch(error) { return { status: 'fail', phase: 'execute', error: error.message }; }
  finally { vm?.stop(); }
}
export async function runtimeObservations(fixtures, options = {}) {
  const rows = [];
  for (const fixture of fixtures) for (const engine of ['js-source-vm', 'js-cil-vm']) rows.push({ id: fixture.id, engine, ...await executeProbe(fixture, engine, options) });
  return rows;
}
