import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, wasmEligibility} from '@sharpforge/runtime';

const compiled = compileToIL(`class Program {
  static void Main() { int total = 0; for (int i = 0; i < 20; i++) total += i * 2; Console.WriteLine(total); }
}`);
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
const vm = new CilVirtualMachine(compiled.assembly);
try {
  const main = [...vm.inspector.methods.values()].find(method => method.name === 'Main');
  const report = wasmEligibility(vm, vm.inspector.getMethod(main.token));
  console.log(JSON.stringify({eligible: report.eligible, reasons: report.reasons,
    instructions: report.ir?.instructions.length ?? 0,
    nativeInstructions: report.ir?.nativeInstructions ?? 0}, null, 2));
} finally {
  vm.stop();
}
