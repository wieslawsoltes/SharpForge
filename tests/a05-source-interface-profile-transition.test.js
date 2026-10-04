import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const cases = [
  ['interface dispatch', `using System;
    interface IShape { int Area(); }
    class Sq : IShape { public int Area() { return 4; } }
    class Program { static void Main() { IShape shape = new Sq(); Console.WriteLine(shape.Area()); } }`, '4\n'],
  ['closed generic structs', `using System;
    struct Opt<T> { public T V; }
    class Program { static void Main() { var value = new Opt<int>(); value.V = 2; Console.WriteLine(value.V); } }`, '2\n'],
  ['closed type names', `using System;
    static class U { public static string N<T>() { return typeof(T).Name; } }
    class Program { static void Main() { Console.WriteLine(U.N<int>()); } }`, 'Int32\n']
];

for (const [name, source, expected] of cases) test('former generic-lowering exclusion has three-route parity: ' + name, () => {
  const artifact = compileToIL(source);
  assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
  for (const vm of [new VirtualMachine(artifact.image), new VirtualMachine(loadAssembly(artifact.assembly)),
    new CilVirtualMachine(artifact.assembly)]) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, expected);
    vm.stop();
  }
});
