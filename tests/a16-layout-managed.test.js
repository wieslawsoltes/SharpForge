import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { loadAssembly } from '@sharpforge/cil';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

const prefix = 'using System;using Microsoft.UI.Xaml;using Microsoft.UI.Xaml.Controls;using Windows.Foundation;';
const cases = [
  ['synchronous detached subtree Measure/Arrange', `
    StackPanel p=new StackPanel(){Spacing=3};
    p.Children.Add(new Border(){Width=40,Height=10});
    p.Children.Add(new Border(){Width=60,Height=20});
    p.Measure(new Size(200,200));
    Console.WriteLine(p.DesiredSize.Width);Console.WriteLine(p.DesiredSize.Height);
    p.Arrange(new Rect(5,7,200,100));
    Console.WriteLine(p.RenderSize.Width);Console.WriteLine(p.ActualHeight);`, '60\n33\n200\n100\n'],
  ['invalidation remeasures changed descendants', `
    Grid p=new Grid();Border child=new Border(){Width=30,Height=20};p.Children.Add(child);
    p.Measure(new Size(200,200));Console.WriteLine(p.DesiredSize.Width);
    child.Width=70;p.InvalidateMeasure();p.Measure(new Size(200,200));Console.WriteLine(p.DesiredSize.Width);`, '30\n70\n'],
  ['custom overrides execute on the same managed receiver', `
    class Probe:Panel {
      protected override Size MeasureOverride(Size available){return new Size(37,19);}
      protected override Size ArrangeOverride(Size available){return new Size(31,17);}
    }
    class P {static void Main(){Probe p=new Probe();p.Measure(new Size(100,100));
      p.Arrange(new Rect(0,0,100,100));Console.WriteLine(p.DesiredSize.Width);
      Console.WriteLine(p.RenderSize.Width);Console.WriteLine(p.ActualHeight);}}`, '37\n31\n17\n'],
  ['headless text metrics require a real provider', `
    TextBlock text=new TextBlock(){Text="Needs actual font metrics"};
    try{text.Measure(new Size(100,100));}catch(NotSupportedException){Console.WriteLine("font service required");}`,
  'font service required\n']
];
const cache = new Map();
function program(source) {
  if (!cache.has(source)) {
    const result = compileToIL(prefix + source);
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    cache.set(source, result);
  }
  return cache.get(source);
}

for (const [name, factory] of Object.entries({ source: value => new VirtualMachine(value.image, { virtualTime: true }),
  reload: value => new VirtualMachine(loadAssembly(value.assembly), { virtualTime: true }),
  cil: value => new CilVirtualMachine(value.assembly, { virtualTime: true }) })) {
  for (const [description, source, expected] of cases) test(`${name}: ${description}`, async () => {
    const vm = factory(program(source));
    const result = await vm.runAsync();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, expected);
    vm.stop();
  });
}
