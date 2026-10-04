import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = `using System;
using System.Text;
class Probe {
  public override string ToString() { Console.Write("stopping"); return "payload"; }
}
class Program {
  static void Main() {
    var builder = new StringBuilder("before");
    try { builder.Insert(-1, (object)new Probe()); Console.Write("resumed"); }
    catch (Exception error) { Console.Write("caught"); }
    Console.Write("after");
  }
}`;

for (const pipeline of ['bound', 'legacy']) {
  for (const engine of ['source', 'cil']) {
    test(`StringBuilder.Insert ${pipeline}/${engine}: stopping in Object.ToString cancels subsequent validation and writes`, () => {
      const program = compileToIL(source, {pipeline});
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
      let writes = 0;
      let stopped = null;
      vm.onWrite = () => { writes++; };
      vm.onOutput = text => {
        assert.equal(text, 'stopping');
        vm.stop();
        stopped = {writes, allocations: vm.heap.stats.allocations};
      };
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.fault, null);
        assert.equal(result.output, 'stopping');
        assert.ok(stopped, 'The managed override must execute the stopping callback');
        assert.equal(writes, stopped.writes, 'A canceled conversion cannot continue builder mutation');
        assert.equal(vm.heap.stats.allocations, stopped.allocations, 'A canceled conversion cannot allocate insertion text');
        assert.equal(vm.frames.length, 0);
        if (engine === 'source') assert.equal(vm.stack.length, 0);
      } finally {
        vm.onOutput = () => {};
        vm.onWrite = null;
        vm.stop();
      }
    });
  }
}
