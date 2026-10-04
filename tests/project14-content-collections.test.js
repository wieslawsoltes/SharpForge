import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly, formatILDocument, assembleILDocument} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const imports = `using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media; using Microsoft.UI.Xaml.Markup;`;
const engines = {
  source: program => new VirtualMachine(program.image),
  canonical: program => new VirtualMachine(loadAssembly(program.assembly)),
  cil: program => new CilVirtualMachine(program.assembly),
  reassembled: program => new CilVirtualMachine(assembleILDocument(formatILDocument(program.assembly)).bytes)
};

const nativeCollections = `
  LinearGradientBrush brush = (LinearGradientBrush)XamlReader.Load(
    "<LinearGradientBrush xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'>" +
    "<LinearGradientBrush.GradientStops><GradientStop Color='Red' Offset='0.25'/>" +
    "<GradientStop Color='Blue' Offset='0.75'/></LinearGradientBrush.GradientStops></LinearGradientBrush>");
  Console.WriteLine(brush.GradientStops.Count);
  Console.WriteLine(brush.GradientStops[0].Offset);
  GC.Collect(); Console.WriteLine(brush.GradientStops[1].Offset);
  brush.GradientStops.RemoveAt(0); Console.WriteLine(brush.GradientStops.Count);
`;

const templateParents = `
  Button button = new Button();
  button.Template = (ControlTemplate)XamlReader.Load(
    "<ControlTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' " +
    "xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml' TargetType='Button'>" +
    "<Border><TextBlock Text='inside'/></Border></ControlTemplate>");
  Console.WriteLine(button.ApplyTemplate());
  Border root = (Border)VisualTreeHelper.GetChild(button, 0);
  TextBlock text = (TextBlock)root.Child;
  Console.WriteLine(Object.ReferenceEquals(text.Parent, button));
  Console.WriteLine(Object.ReferenceEquals(VisualTreeHelper.GetParent(text), root));
  button.Template = null;
  Console.WriteLine(VisualTreeHelper.GetParent(root) == null);
`;

for (const [engine, create] of Object.entries(engines)) {
  for (const [name, source, output] of [
    ['XAML mutates native drawing collections and preserves GC roots', nativeCollections, '2\n0.25\n0.75\n1\n'],
    ['template logical parents preserve the physical visual tree', templateParents, 'True\nTrue\nTrue\nTrue\n']
  ]) {
    test(`Project 14 ${engine}: ${name}`, () => {
      const program = compileToIL(imports + source);
      assert.equal(program.success, true, JSON.stringify(program.diagnostics));
      const vm = create(program);
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
        assert.equal(result.output, output);
      } finally { vm.stop(); }
    });
  }
}
