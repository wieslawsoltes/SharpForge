import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { loadAssembly, formatILDocument, assembleILDocument } from '@sharpforge/cil';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

const source = `using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Documents; using Microsoft.UI.Text;
  Bold bold = new Bold(); Run run = new Run(); bold.Inlines.Add(run);
  Console.WriteLine((int)bold.FontWeight.Weight); Console.WriteLine((int)run.FontWeight.Weight);
  bold.FontWeight = FontWeights.Normal;
  Console.WriteLine((int)bold.FontWeight.Weight); Console.WriteLine((int)run.FontWeight.Weight);
  bold.ClearValue(TextElement.FontWeightProperty);
  Console.WriteLine((int)bold.FontWeight.Weight); Console.WriteLine((int)run.FontWeight.Weight);
  Italic italic = new Italic(); Console.WriteLine((int)italic.FontStyle);
  italic.FontStyle = Windows.UI.Text.FontStyle.Normal;
  Console.WriteLine((int)italic.FontStyle); italic.ClearValue(TextElement.FontStyleProperty);
  Console.WriteLine((int)italic.FontStyle);`;

const engines = {
  source: built => new VirtualMachine(built.image),
  canonical: built => new VirtualMachine(loadAssembly(built.assembly)),
  cil: built => new CilVirtualMachine(built.assembly),
  reassembled: built => new CilVirtualMachine(assembleILDocument(formatILDocument(built.assembly)).bytes)
};

for (const [name, create] of Object.entries(engines)) {
  test(`A16 ${name}: Bold and Italic defaults inherit and survive local override/clear`, () => {
    const built = compileToIL(source, { includeDebug: true });
    assert.equal(built.success, true, built.diagnostics.map(value => value.message).join('\n'));
    const machine = create(built);
    try {
      const result = machine.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '700\n700\n400\n400\n700\n700\n2\n0\n2\n');
    } finally { machine.stop(); }
  });
}
