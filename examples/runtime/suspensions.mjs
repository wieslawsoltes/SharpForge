// node examples/runtime/suspensions.mjs
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, instructionProfile} from '@sharpforge/runtime';

const artifact = compileToIL(`using System.Threading; class Program {
  static void Main() { Thread.Sleep(10); Console.Write("awake"); }
}`);
if (!artifact.success) throw new Error(JSON.stringify(artifact.diagnostics));
for (const engine of ['source', 'reload', 'cil']) {
  const options = {profile: true, runtimeEvents: false, virtualTime: true};
  const vm = engine === 'cil' ? new CilVirtualMachine(artifact.assembly, options)
    : new VirtualMachine(engine === 'source' ? artifact.image : artifact.assembly, options);
  try {
    const waiting = vm.run();
    if (waiting.state !== 'waiting') throw waiting.fault ?? new Error('Expected a guest wait');
    const parked = instructionProfile(vm).suspensions;
    vm.scheduler.advance(10);
    const result = vm.run();
    if (result.state !== 'terminated') throw result.fault ?? new Error('Expected completion');
    console.log(JSON.stringify({engine, parked, afterWake: instructionProfile(vm).suspensions, output: result.output}));
  } finally { vm.stop(); }
}
