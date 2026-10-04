import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = `
  using System;
  using System.Threading;
  using System.Threading.Tasks;
  class Gate {}
  class P {
    static void Main() {
      var gate = new Gate(); int turn = 0;
      Action action = () => {
        lock(gate) {
          while(turn == 0) Monitor.Wait(gate);
          Console.WriteLine(turn);turn = 2;Monitor.Pulse(gate);
        }
      };
      var first = Task.Run(action);
      var second = Task.Run(() => {
        lock(gate) {
          turn = 1;Monitor.Pulse(gate);
          while(turn != 2) Monitor.Wait(gate);
          Console.WriteLine(turn);
        }
      });
      first.Wait();second.Wait();Console.WriteLine(Monitor.IsEntered(gate));
    }
  }
`;

for (const engine of ['source', 'reload', 'cil']) test(`${engine}: guest Monitor Wait/Pulse transfers ownership between Task contexts`, async () => {
  const compiled = compileToIL(source);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  const options = {virtualTime: true, maxInstructions: 100000};
  const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly, options)
    : new VirtualMachine(engine === 'reload' ? loadAssembly(compiled.assembly) : compiled.image, options);
  try {
    const result = await vm.runAsync();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(result.output, '1\n2\nFalse\n');
    assert.equal(vm.sync.blocks.size, 0);
    assert.deepEqual(vm.sync.deadlocks().cycles, []);
    assert.equal([...vm.scheduler.contexts.values()].filter(context => context.status === 'waiting').length, 0);
  } finally { vm.stop(); }
});
