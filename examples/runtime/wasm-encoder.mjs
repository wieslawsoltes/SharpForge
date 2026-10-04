import {CilVirtualMachine, lowerWasmIR, encodeWasmIR} from '@sharpforge/runtime';
import {compileToIL} from '@sharpforge/compiler';

const compiled = compileToIL('class Program { static void Main() { Console.WriteLine(21 * 2); } }');
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
const vm = new CilVirtualMachine(compiled.assembly);
try {
  const main = [...vm.inspector.methods.values()].find(method => method.name === 'Main');
  const ir = lowerWasmIR(vm, vm.inspector.getMethod(main.token));
  const bytes = encodeWasmIR(ir);
  console.log(JSON.stringify({byteLength: bytes.length, validModule: WebAssembly.validate(bytes),
    instructionEntries: ir.instructions.length}));
} finally { vm.stop(); }
