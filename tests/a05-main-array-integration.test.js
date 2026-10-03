import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = `using System;
class Program {
  static void Main() {
    int Visit() {
      int[,] values = new int[,] {{1, 2}, {3, 4}};
      int dimension = 1;
      Console.WriteLine(values.Rank);
      Console.WriteLine(values.GetLength(dimension));
      Console.WriteLine(values.GetUpperBound(dimension));
      int sum = 0;
      Func<int> last = null;
      foreach (int value in values) { sum += value; last = () => value; }
      Console.WriteLine(last());
      foreach (int value in new int[0, 2]) { sum += 100; }
      return sum;
    }
    Console.WriteLine(Visit());
  }
}`;

for (const engine of ['source', 'reload', 'cil']) {
  test('main integration preserves rectangular members and captured foreach cells: ' + engine, () => {
    const artifact = compileToIL(source);
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    const vm = engine === 'cil' ? new CilVirtualMachine(artifact.assembly) :
      new VirtualMachine(engine === 'reload' ? loadAssembly(artifact.assembly) : artifact.image);
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '2\n2\n1\n4\n10\n');
  });
}
