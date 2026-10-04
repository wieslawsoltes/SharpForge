// Run after E02 assembly: node examples/runtime/profile.mjs [source|reload|cil] [instructions|duration]
// Save stdout as profile.json and open it in Speedscope.
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, exportSpeedscope} from '@sharpforge/runtime';

const engine = process.argv[2] ?? 'cil';
const metric = process.argv[3] ?? 'instructions';
if (!['source', 'reload', 'cil'].includes(engine)) throw new Error('Expected source, reload or cil');
if (!['instructions', 'duration'].includes(metric)) throw new Error('Expected instructions or duration');
const artifact = compileToIL(`class Program {
  static int Sum(int count) {
    int total = 0;
    for (int i = 0; i < count; i++) total += i;
    return total;
  }
  static void Main() { Console.WriteLine(Sum(10000)); }
}`);
if (!artifact.success) throw new Error(JSON.stringify(artifact.diagnostics));
const options = {profile: {sampleBudget: 256, events: {capacity: 1024}}};
const vm = engine === 'cil' ? new CilVirtualMachine(artifact.assembly, options)
  : new VirtualMachine(engine === 'source' ? artifact.image : loadAssembly(artifact.assembly), options);
const result = vm.run();
if (result.state !== 'terminated') throw result.fault ?? new Error('Execution did not terminate');
console.error(result.output.trim());
console.log(JSON.stringify(exportSpeedscope(vm.profiler, {name: 'Sum (' + engine + ')', metric}), null, 2));
