import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const cases = [
  ['generic local ref results', `using System; class Program { static void Main() {
    ref T Pick<T>(T[] items) { return ref items[0]; }
    int[] values = new int[] { 7 };
    Console.WriteLine(Pick(values));
    ref int slot = ref Pick(values); slot = 9;
    Console.WriteLine(values[0]);
  }}`, '7\n9\n'],
  ['numeric caller information', `using System; using System.Runtime.CompilerServices;
  class Program {
    static int Line([CallerLineNumber] int line = 0) { return line; }
    static void Main() { int Read() => Line(); Console.WriteLine(Read() > 0); }
  }`, 'True\n']
];

for (const [name, source, expected] of cases) for (const engine of ['source', 'reload', 'cil']) {
  test('main integration retains ' + name + ': ' + engine, () => {
    const artifact = compileToIL(source);
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    const vm = engine === 'cil' ? new CilVirtualMachine(artifact.assembly) :
      new VirtualMachine(engine === 'reload' ? loadAssembly(artifact.assembly) : artifact.image);
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, expected);
  });
}
