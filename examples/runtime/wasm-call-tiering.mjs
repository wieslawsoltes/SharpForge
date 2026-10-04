import {readFile} from 'node:fs/promises';
import {setImmediate as yieldToHost} from 'node:timers/promises';
import {CilVirtualMachine, wasmTieringStatistics, disposeWasmTiering} from '@sharpforge/runtime';

// node examples/runtime/wasm-call-tiering.mjs program.dll
const path = process.argv[2];
if (!path) throw new Error('Pass a managed DLL path');
const vm = new CilVirtualMachine(new Uint8Array(await readFile(path)), {wasmTiering: {callThreshold: 32}});
try {
  while (vm.state === 'ready' || vm.state === 'running') {
    vm.runSlice({instructionBudget: 15000, timeBudgetMs: 8});
    await yieldToHost();
  }
  console.log(vm.output.join(''));
  console.log(JSON.stringify(wasmTieringStatistics(vm), null, 2));
  if (vm.fault) throw vm.fault;
} finally {
  disposeWasmTiering(vm);
  vm.stop();
}
