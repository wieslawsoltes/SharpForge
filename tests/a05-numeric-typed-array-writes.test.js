import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const prefix = 'using System; using System.Numerics; using System.Threading.Tasks; using SharpForge.Runtime;';
const cases = [
  ['vector writes', `class Program { static void Main() {
    var vector = new Vector<double>(new double[] { 3.5, -0.0 });
    double[] values = new double[] { 9.0, 8.0, 7.0, 6.0 };
    vector.CopyTo(values, 1);
    Console.WriteLine(values[0]); Console.WriteLine(values[1]);
    Console.WriteLine(1.0 / values[2]); Console.WriteLine(values[3]);
  } }`, '9\n3.5\n-Infinity\n6\n'],
  ['parallel result writes', `class Program { static async Task Main() {
    var values = await ParallelMath.AddAsync(new double[] { 1.25, -2.5 }, new double[] { 4.5, 8.75 });
    Console.WriteLine(values[0]); Console.WriteLine(values[1]);
  } }`, '5.75\n6.25\n']
];

for (const [name, source, expected] of cases) {
  for (const engine of ['source', 'reload', 'cil']) test(`${engine} ${name} preserve typed float backing`, async () => {
    const compiled = compileToIL(prefix + source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const options = {compute: {workers: 1, backend: 'scalar'}};
    const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly, options)
      : new VirtualMachine(engine === 'reload' ? loadAssembly(compiled.assembly) : compiled.image, options);
    try {
      const result = await vm.runAsync();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, expected);
    } finally { vm.stop(); }
  });
}
