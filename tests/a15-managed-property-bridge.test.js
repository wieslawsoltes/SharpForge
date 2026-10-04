import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {loadAssembly} from '@sharpforge/cil';

const prefix = 'using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;';
const engines = {
  source: result => new VirtualMachine(result.image, {initialThreshold: 64}),
  canonical: result => new VirtualMachine(loadAssembly(result.assembly), {initialThreshold: 64}),
  cil: result => new CilVirtualMachine(result.assembly, {initialThreshold: 64})
};

const cases = [
  {
    name: 'declaring owner identity and local null survive collection',
    source: `
      Button button = new Button();
      Console.WriteLine(Button.ContentProperty == ContentControl.ContentProperty);
      Console.WriteLine(button.ReadLocalValue(Button.ContentProperty) == DependencyProperty.UnsetValue);
      button.SetValue(Button.ContentProperty, null);
      GC.Collect();
      Console.WriteLine(button.ReadLocalValue(Button.ContentProperty) == null);
      button.ClearValue(Button.ContentProperty);
      Console.WriteLine(button.ReadLocalValue(Button.ContentProperty) == DependencyProperty.UnsetValue);
    `,
    output: 'True\nTrue\nTrue\nTrue\n'
  },
  {
    name: 'attached accessors and dependency methods share a local slot',
    source: `
      Button button = new Button();
      Console.WriteLine(button.ReadLocalValue(Grid.RowProperty) == DependencyProperty.UnsetValue);
      Grid.SetRow(button, 2);
      Console.WriteLine(button.GetValue(Grid.RowProperty));
      button.SetValue(Grid.RowProperty, 3);
      Console.WriteLine(Grid.GetRow(button));
      button.ClearValue(Grid.RowProperty);
      Console.WriteLine(Grid.GetRow(button));
    `,
    output: 'True\n2\n3\n0\n'
  },
  {
    name: 'invalid assignments preserve the prior effective value',
    source: `
      Button button = new Button();
      button.Width = 42;
      try { button.SetValue(Button.WidthProperty, "invalid"); }
      catch (ArgumentException error) { Console.WriteLine("rejected"); }
      Console.WriteLine(button.Width);
      GC.Collect();
      Console.WriteLine(button.GetValue(Button.WidthProperty));
    `,
    output: 'rejected\n42\n42\n'
  },
  {
    name: 'range failures retain their managed exception type and the prior local value',
    source: `
      Button button = new Button(); button.Width = 42;
      try { button.Width = -1; }
      catch (ArgumentOutOfRangeException error) { Console.WriteLine("range rejected"); }
      Console.WriteLine(button.Width);
      Console.WriteLine(button.ReadLocalValue(Button.WidthProperty));
    `,
    output: 'range rejected\n42\n42\n'
  }
];

for (const fixture of cases) test(fixture.name + ' across managed engines', () => {
  const result = compileToIL(prefix + fixture.source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  for (const [name, create] of Object.entries(engines)) {
    const vm = create(result);
    const actual = vm.run();
    assert.equal(actual.state, 'terminated', name + ': ' + JSON.stringify(actual.fault));
    assert.equal(actual.output, fixture.output, name);
  }
});

test('property store values restore with the managed heap snapshot', () => {
  const result = compileToIL(prefix + 'Button button = new Button(); button.Width = 42; Console.WriteLine(button.Width);');
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  for (const create of Object.values(engines)) {
    const vm = create(result);
    vm.run();
    const platform = vm.platform;
    const reference = platform.construct('Microsoft.UI.Xaml.Controls.Button', []);
    const handle = vm.heap.createHandle(reference);
    const property = platform.ui.properties.lookup(reference, 'Width');
    platform.setProperty(reference, {owner: property.ownerType, property: 'Width'}, platform.managed(17, 'double'));
    const snapshot = vm.snapshot();
    platform.setProperty(reference, {owner: property.ownerType, property: 'Width'}, platform.managed(99, 'double'));
    vm.restore(snapshot);
    assert.equal(platform.native(platform.ui.properties.read(reference, property)), 17);
    vm.heap.releaseHandle(handle);
  }
});
