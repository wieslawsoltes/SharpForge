import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, instructionProfile} from '@sharpforge/runtime';

const compiled = compileToIL(`class Program {
  static int Twice(int value) { return value * 2; }
  static void Main() { int sum = 0; for (int i = 0; i < 20; i++) sum += Twice(i); Console.WriteLine(sum); }
}`);
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
const profile = process.argv.includes('--duration') ? {duration: true} : true;
for (const engine of ['source', 'reload', 'cil']) {
  const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly, {profile})
    : new VirtualMachine(engine === 'source' ? compiled.image : compiled.assembly, {profile});
  try {
    const result = vm.run();
    if (result.state !== 'terminated' || result.output !== '380\n') throw new Error(engine + ': unexpected execution result');
    console.log(JSON.stringify({engine, output: result.output, profile: instructionProfile(vm)}, null, 2));
  } finally { vm.stop(); }
}
