import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine} from '@sharpforge/runtime';

const compiled = compileToIL(`class Program {
  static void Main() {
    int sum = 0;
    for (int index = 0; index < 100; index++) sum += index;
    Console.WriteLine(sum);
  }
}`);
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
for (const specializeNumericHandlers of [false, true]) {
  const vm = new CilVirtualMachine(compiled.assembly, {specializeNumericHandlers});
  const result = vm.run();
  if (result.state !== 'terminated') throw result.fault;
  console.log(specializeNumericHandlers ? 'Int32 specialization:' : 'Reference handlers:', result.output.trim());
}
