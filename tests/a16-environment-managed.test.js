import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { loadAssembly } from '@sharpforge/cil';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';
import { EnvironmentState } from '@sharpforge/winui-controls';

const source = `using System;using Windows.UI.ViewManagement;using Microsoft.UI.Xaml.Controls;
UISettings settings=new UISettings();AccessibilitySettings accessibility=new AccessibilitySettings();
Console.WriteLine(settings.TextScaleFactor);Console.WriteLine(settings.AnimationsEnabled);
Console.WriteLine(accessibility.HighContrast);Console.WriteLine(accessibility.HighContrastScheme);
InputPane pane=InputPane.GetForCurrentView();Console.WriteLine(Object.ReferenceEquals(pane,InputPane.GetForCurrentView()));
Console.WriteLine(pane.OccludedRect.Height);Console.WriteLine(pane.TryShow());Console.WriteLine(pane.TryHide());
Button button=new Button();Console.WriteLine(button.XamlRoot==null);`;
let compiled;
function program() {
  if (!compiled) {
    compiled = compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  }
  return compiled;
}
for (const [name, create] of Object.entries({ source: (p, options) => new VirtualMachine(p.image, options),
  reload: (p, options) => new VirtualMachine(loadAssembly(p.assembly), options),
  cil: (p, options) => new CilVirtualMachine(p.assembly, options) })) {
  test(name + ': responsive settings share the injected environment and keyboard absence is explicit', async () => {
    const environment = new EnvironmentState({ TextScaleFactor: 1.5, AnimationsEnabled: false, HighContrast: true,
      HighContrastScheme: 'Test system colors', InputPaneOccludedRect: { X: 0, Y: 400, Width: 320, Height: 168 } });
    const vm = create(program(), { virtualTime: true, uiServices: { environment } });
    const result = await vm.runAsync();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '1.5\nFalse\nTrue\nTest system colors\nTrue\n168\nFalse\nFalse\nTrue\n');
    vm.stop();
  });
}
