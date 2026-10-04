import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, prepareWasmMethod, runWasmSlice, disposeWasmMethod} from '@sharpforge/runtime';

const compiled = compileToIL(`class Program {
  static void Main() { int sum = 0; for (int i = 0; i < 20; i++) sum += i * 2; Console.WriteLine(sum); }
}`);
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
const vm = new CilVirtualMachine(compiled.assembly);
let handle;
try {
  const main = [...vm.inspector.methods.values()].find(method => method.name === 'Main');
  handle = await prepareWasmMethod(vm, vm.inspector.getMethod(main.token));
  while (vm.state === 'ready' || vm.state === 'running') {
    runWasmSlice(vm, handle, {instructionBudget: 15000, timeBudgetMs: 8});
  }
  if (vm.state !== 'terminated') throw vm.fault ?? new Error('Execution did not terminate');
  console.log(JSON.stringify({output: vm.output.join(''), compiledBytes: handle.byteLength, instructions: vm.instructions}));
} finally {
  if (handle) disposeWasmMethod(handle);
  vm.stop();
}
