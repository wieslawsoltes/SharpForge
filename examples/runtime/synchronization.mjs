import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = `
  using System;
  using System.Threading;
  class Gate {}
  class Program {
    static void Main() {
      var gate = new Gate();
      int count = 0;
      lock (gate) {
        lock (gate) { Interlocked.Increment(ref count); }
        Console.WriteLine(Monitor.IsEntered(gate));
      }
      Console.WriteLine(count);
      Console.WriteLine(Monitor.IsEntered(gate));
    }
  }
`;
const compiled = compileToIL(source);
if (!compiled.success) throw new Error(JSON.stringify(compiled.diagnostics));
for (const [name, vm] of [['source', new VirtualMachine(compiled.image)], ['cil', new CilVirtualMachine(compiled.assembly)]]) {
  try {
    const result = vm.run();
    if (result.state !== 'terminated' || result.output !== 'True\n1\nFalse\n') {
      throw new Error(name + ': ' + JSON.stringify(result.fault ?? result.output));
    }
    process.stdout.write(name + ':\n' + result.output);
  } finally { vm.stop(); }
}
