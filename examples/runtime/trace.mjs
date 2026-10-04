// node examples/runtime/trace.mjs > trace.json
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, exportRuntimeTrace} from '@sharpforge/runtime';

const artifact = compileToIL(`class Program {
  static int Twice(int value) { return value * 2; }
  static void Main() { Console.WriteLine(Twice(21)); }
}`);
if (!artifact.success) throw new Error(JSON.stringify(artifact.diagnostics));
const vm = new CilVirtualMachine(artifact.assembly, {runtimeEvents: {capacity: 256}});
try {
  const result = vm.run();
  if (result.state !== 'terminated') throw result.fault ?? new Error('Execution did not terminate');
  console.error(result.output.trim());
  console.log(JSON.stringify(exportRuntimeTrace(vm.runtimeEvents, {limit: 256}), null, 2));
} finally { vm.stop(); }
