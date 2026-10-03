// Run from the repository: node examples/runtime/snapshot-replay.mjs
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const compiled = compileToIL('int value=40;value+=2;Console.WriteLine(value);');
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
for (const vm of [new VirtualMachine(compiled.image), new CilVirtualMachine(compiled.assembly)]) {
  vm.runSlice({instructionBudget: 3, timeBudgetMs: 1000});
  const snapshot = vm.snapshot(), first = vm.run();
  vm.restore(snapshot);
  const replay = vm.run();
  if (first.output !== replay.output || first.state !== replay.state) throw new Error('Replay diverged');
  console.log(`${snapshot.engine} schema ${snapshot.schemaVersion}: ${replay.output.trim()}`);
}
