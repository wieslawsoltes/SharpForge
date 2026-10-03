import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {loadAssembly} from '@sharpforge/cil';

test('Array source APIs preserve results across source, reloaded source and CIL', () => {
  const compiled = compileToIL(`class Program {
    static void Main() {
      int[] values = new int[] { 1, 2, 3, 4 };
      Array.Copy(values, 0, values, 1, 3);
      Console.WriteLine(values[2]);
      Array.Clear(values, 1, 1);
      Console.WriteLine(values[1]);
      Console.WriteLine(Array.IndexOf(values, 3));
      Array.Resize(ref values, 6);
      Console.WriteLine(values.Length);
      Console.WriteLine(values[5]);
      Console.WriteLine(values.GetLength(0));
      Console.WriteLine(values.Rank);
      Console.WriteLine(values.LongLength);
      object clone = values.Clone();
      Console.WriteLine(object.ReferenceEquals(values, clone));
    }
  }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const vm of [new VirtualMachine(compiled.image), new VirtualMachine(loadAssembly(compiled.assembly)),
    new CilVirtualMachine(compiled.assembly)]) {
    vm.run();
    assert.equal(vm.state, 'terminated', vm.fault?.message);
    assert.equal(vm.output.join(''), '2\n0\n3\n6\n0\n6\n1\n6\nFalse\n');
  }
});

for (const pipeline of ['bound', 'legacy']) {
  test('Array.Resize substitutes its ref element type in the ' + pipeline + ' pipeline', () => {
    const compiled = compileToIL(`using System; class Program {
      static void Main() {
        int[] numbers = new int[] { 7 };
        Array.Resize(ref numbers, 3);
        string[] words = new string[] { "kept" };
        System.Array.Resize<string>(ref words, 2);
        Console.WriteLine(numbers[0]);
        Console.WriteLine(numbers[2]);
        Console.WriteLine(words[0]);
        Console.WriteLine(words[1] == null);
      }
    }`, {pipeline});
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    for (const vm of [new VirtualMachine(compiled.image), new VirtualMachine(loadAssembly(compiled.assembly)),
      new CilVirtualMachine(compiled.assembly)]) {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '7\n0\nkept\nTrue\n');
    }
  });

  for (const argument of ['values', 'out values', 'in values', 'ref values']) {
    test('Array.Resize enforces an invariant ref array type: ' + pipeline + ', ' + argument, () => {
      const result = compile('using System; class Program { static void Main() {' +
        'string[] values = new string[1]; Array.Resize<object>(' + argument + ', 3); }}', {pipeline});
      assert.equal(result.success, false);
      assert(result.diagnostics.some(item => item.severity === 'error'));
    });
  }
}
