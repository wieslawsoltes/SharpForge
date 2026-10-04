import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly, formatILDocument, assembleILDocument} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = `using System; using Microsoft.UI.Xaml.Documents;
  Bold first = new Bold(); Bold second = new Bold(); Run run = new Run();
  first.Inlines.Add(run); Console.WriteLine((int)run.FontWeight.Weight);
  try { first.Inlines.Add(run); } catch (InvalidOperationException error) { Console.WriteLine("duplicate"); }
  try { second.Inlines.Add(run); } catch (InvalidOperationException error) { Console.WriteLine("owned"); }
  try { first.Inlines.Add(first); } catch (InvalidOperationException error) { Console.WriteLine("cycle"); }
  Console.WriteLine(first.Inlines.Count);
  first.Inlines.Clear(); Console.WriteLine((int)run.FontWeight.Weight);
  second.Inlines.Add(run); Console.WriteLine((int)run.FontWeight.Weight);
  second.Inlines.Remove(run); Console.WriteLine((int)run.FontWeight.Weight);`;

const engines = {
  source: built => new VirtualMachine(built.image),
  canonical: built => new VirtualMachine(loadAssembly(built.assembly)),
  cil: built => new CilVirtualMachine(built.assembly),
  reassembled: built => new CilVirtualMachine(assembleILDocument(formatILDocument(built.assembly)).bytes)
};

for (const [name, create] of Object.entries(engines)) {
  test(`A16 ${name}: inline ownership is unique acyclic and detachable without visual children`, () => {
    const built = compileToIL(source, {includeDebug: true});
    assert.equal(built.success, true, built.diagnostics.map(value => value.message).join('\n'));
    const machine = create(built);
    try {
      const result = machine.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '700\nduplicate\nowned\ncycle\n1\n400\n700\n400\n');
      for (const node of machine.platform.ui.objectTree.nodes.values()) {
        const type = machine.platform.ui.typeOf(node.value);
        if (!type?.startsWith('Microsoft.UI.Xaml.Documents.')) continue;
        assert.equal(node.visualParent, null);
        assert.equal(node.visualChildren.size, 0);
      }
      assert.equal(machine.heap.pins.length, 0);
    } finally { machine.stop(); }
  });
}
