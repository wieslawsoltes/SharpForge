import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly, formatILDocument, assembleILDocument} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = `using System; using Microsoft.UI.Xaml.Controls;
  CheckBox box = new CheckBox();
  box.IsChecked = true; Console.WriteLine(box.IsChecked); Console.WriteLine((bool)box.GetChecked());
  box.IsChecked = false; Console.WriteLine(box.IsChecked); Console.WriteLine((bool)box.GetChecked());
  box.SetChecked(null); Console.WriteLine(box.GetChecked() == null);
  box.SetChecked(true); Console.WriteLine(box.IsChecked); Console.WriteLine((bool)box.GetChecked());`;

const engines = {
  source: built => new VirtualMachine(built.image),
  canonical: built => new VirtualMachine(loadAssembly(built.assembly)),
  cil: built => new CilVirtualMachine(built.assembly),
  reassembled: built => new CilVirtualMachine(assembleILDocument(formatILDocument(built.assembly)).bytes)
};

for (const [name, create] of Object.entries(engines)) {
  test(`A16 ${name}: checked state normalizes the bool ABI and boxes its object companion`, () => {
    const built = compileToIL(source, {includeDebug: true});
    assert.equal(built.success, true, built.diagnostics.map(value => value.message).join('\n'));
    const machine = create(built);
    try {
      const result = machine.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, 'True\nTrue\nFalse\nFalse\nTrue\nTrue\nTrue\n');
      assert.equal(machine.heap.pins.length, 0);
    } finally { machine.stop(); }
  });
}
