import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CilVirtualMachine, VirtualMachine } from '@sharpforge/runtime';
import { compileToIL } from '@sharpforge/compiler';
import { formatILDocument, assembleILDocument } from '@sharpforge/cil';
import { designerSamples } from '../../../apps/studio/samples-designer.js';

const managed = {
  Hello: 'Hello from an ordinary managed EXE\n',
  Finally: 'cleanup\n42\ninner cleanup\nfailure\nouter cleanup\n',
  UsingResources: 'acquire outer\nacquire inner\nbody\ndispose inner\ndispose outer\n42\n',
};
for (const [name, output] of Object.entries(managed)) {
  test(`T09 regenerated ${name} executable preserves its observable behavior and IL round trip`, async () => {
    const bytes = await readFile(new URL(`../../../examples/managed/${name}.exe`, import.meta.url));
    const text = await readFile(new URL(`../../../examples/managed/${name}.sf.il`, import.meta.url), 'utf8');
    assert.equal(formatILDocument(bytes), text);
    for (const assembly of [bytes, assembleILDocument(text).bytes]) {
      const result = new CilVirtualMachine(assembly).run();
      assert.equal(result.fault, null);
      assert.equal(result.state, 'terminated');
      assert.equal(result.output, output);
      assert.equal(result.exitCode, 0);
    }
  });
}

for (const id of ['designer-canvas', 'designer-grid']) {
  for (const engine of ['source', 'cil']) {
    test(`T09 ${engine} regenerated ${id} styles retain explicit Button target and reject TextBox`, () => {
      const sample = designerSamples.find((sample) => sample.id === id);
      const files = sample.files.filter((file) => file.uri === 'DesignedView.g.cs');
      files.push({
        uri: 'Program.cs',
        text: `
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
class Program {
    static void Main() {
        DesignedView.Create();
        Console.WriteLine(DesignedView.v_action.Style.TargetTypeName);
        Console.WriteLine(DesignedView.v_action.FontSize);
        TextBox wrong = new TextBox();
        try { wrong.Style = DesignedView.v_action.Style; }
        catch (Exception) { Console.WriteLine("reject-target"); }
    }
    public static void OnAction(object sender, RoutedEventArgs args) { }
}`,
      });
      const compiled = compileToIL(files);
      assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
      const vm =
        engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
      const result = vm.run();
      assert.equal(result.fault, null);
      assert.equal(result.output, 'Microsoft.UI.Xaml.Controls.Button\n15\nreject-target\n');
      const button = vm.platform.scene().nodes.find((node) => node.properties.Name === 'ActionButton');
      assert.equal(button.properties.Background.Color.B, 184);
    });
  }
}
