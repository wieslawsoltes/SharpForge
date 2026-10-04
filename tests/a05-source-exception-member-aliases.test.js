import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = `using System;
using System.Runtime.ExceptionServices;
class P {
  static void Print(FirstChanceExceptionEventArgs args) { Console.WriteLine(args.Exception.Message); }
  static void Main() { Print(new FirstChanceExceptionEventArgs(new Exception("typed-event"))); }
}`;

for (const pipeline of ['legacy', 'bound']) {
  test(`T04 ${pipeline}: framework property results retain the canonical Exception.Message member`, () => {
    const result = compileToIL(source, {pipeline});
    assert(result.success, JSON.stringify(result.diagnostics));
    for (const vm of [new VirtualMachine(result.image), new VirtualMachine(loadAssembly(result.assembly)),
      new CilVirtualMachine(result.assembly)]) {
      const finished = vm.run();
      assert.equal(finished.state, 'terminated', JSON.stringify(finished.fault));
      assert.equal(finished.output, 'typed-event\n');
    }
  });
}
