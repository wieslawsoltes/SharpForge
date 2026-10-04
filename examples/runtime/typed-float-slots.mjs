import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine} from '@sharpforge/runtime';

const source = `class Program {
  static void Main() {
    double sum = 0;
    for (int index = 0; index < 100; index++) sum += 0.25;
    Console.WriteLine(sum);
  }
}`;
const compiled = compileToIL(source);
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
for (const typedNumericStack of [false, true]) {
  const vm = new CilVirtualMachine(compiled.assembly, {typedNumericStack});
  const result = vm.run();
  if (result.state !== 'terminated') throw result.fault;
  console.log(typedNumericStack ? 'Typed float slots:' : 'Reference slots:', result.output.trim());
}
