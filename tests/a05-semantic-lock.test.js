import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = `using System;using System.Threading;
class Program {
  static object gate = new int[1];
  static int evaluations;
  static object Gate() { evaluations++; return gate; }
  static int ReturnInside() { lock(gate) { return 7; } }
  static void Main() {
    try {
      lock(Gate()) {
        Console.WriteLine(Monitor.IsEntered(gate));
        throw new InvalidOperationException("released");
      }
    } catch(InvalidOperationException error) {
      Console.WriteLine(error.Message);
    }
    Console.WriteLine(evaluations);
    Console.WriteLine(Monitor.IsEntered(gate));
    Console.WriteLine(ReturnInside());
    Console.WriteLine(Monitor.IsEntered(gate));
  }
}`;

const engines = {
  source: artifact => new VirtualMachine(artifact.image),
  reload: artifact => new VirtualMachine(loadAssembly(artifact.assembly)),
  cil: artifact => new CilVirtualMachine(artifact.assembly)
};
for (const [engine, create] of Object.entries(engines)) test('E01 semantic lock ' + engine + ': acquire once, release on throw and return', () => {
  const artifact = compileToIL(source);
  assert(artifact.success, JSON.stringify(artifact.diagnostics));
  const result = create(artifact).run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, 'True\nreleased\n1\nFalse\n7\nFalse\n');
});
