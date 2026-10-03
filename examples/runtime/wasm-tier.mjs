// Run after E02 assembly: node examples/runtime/wasm-tier.mjs [entry|osr]
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, prepareWasmTier, wasmTierStatistics} from '@sharpforge/runtime';

const mode = process.argv[2] ?? 'osr';
if (!['entry', 'osr'].includes(mode)) throw new Error('Expected entry or osr');
const artifact = compileToIL(`class Program {
  static int Main() {
    int sum = 0;
    for (int i = 0; i < 100000; i++) sum = (sum + i) ^ (i >> 2);
    return sum;
  }
}`);
if (!artifact.success) throw new Error(JSON.stringify(artifact.diagnostics));
const vm = new CilVirtualMachine(artifact.assembly, {wasmTiering: {callThreshold: 32, backedgeThreshold: 8}});
if (mode === 'entry') {
  const prepared = await prepareWasmTier(vm);
  if (prepared.status !== 'ready') throw new Error(JSON.stringify(prepared));
}
const result = await vm.runAsync();
if (result.fault) throw result.fault;
console.log(JSON.stringify({result: result.returnValue, instructions: vm.instructions, tier: wasmTierStatistics(vm)}, null, 2));
