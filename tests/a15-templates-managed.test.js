import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {getResourceServices} from '@sharpforge/winui-properties';

const imports = `using System; using Microsoft.UI; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
  using Microsoft.UI.Xaml.Media; using Microsoft.UI.Xaml.Markup;`;
const namespace = "xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation' " +
  "xmlns:x='http://schemas.microsoft.com/winfx/2006/xaml'";

function create(source, Engine, options = {}) {
  const built = compileToIL(imports + source, {includeDebug: false});
  assert.equal(built.success, true, built.diagnostics.map(item => item.message).join('\n'));
  return new Engine(Engine === VirtualMachine ? built.image : built.assembly, {initialThreshold: 4096, ...options});
}

for (const Engine of [VirtualMachine, CilVirtualMachine]) {
  test(`A15 ${Engine.name}: XAML templates above 1000 nodes instantiate without sharing mutable visuals`, () => {
    const template = `<ControlTemplate ${namespace} TargetType='Control'><StackPanel>` +
      Array.from({length: 1200}, (_, index) => `<Border Name='part${index}'/>`).join('') + '</StackPanel></ControlTemplate>';
    const vm = create(`ControlTemplate template = (ControlTemplate)XamlReader.Load(${JSON.stringify(template)});
      StackPanel first = (StackPanel)template.LoadContent(); StackPanel second = (StackPanel)template.LoadContent();
      Console.WriteLine(first.Children.Count); Console.WriteLine(second.Children.Count);
      Console.WriteLine(Object.ReferenceEquals(first.Children[1199], second.Children[1199]));
      GC.Collect(); Console.WriteLine(((FrameworkElement)second.Children[1199]).Name);`, Engine, {maxUICommands: 50000});
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '1200\n1200\nFalse\npart1199\n');
      assert.equal(vm.heap.pins.length, 0);
      assert.equal(vm.platform.ui.construction.size, 0);
    } finally { vm.stop(); }
  });

  test(`A15 ${Engine.name}: ContentPresenter inherits foreground and replaces content templates through live bindings`, () => {
    const template = `<ControlTemplate ${namespace} TargetType='Button'>` +
      "<ContentPresenter Name='slot' Content='{TemplateBinding Content}' ContentTemplate='{TemplateBinding ContentTemplate}'/>" +
      '</ControlTemplate>';
    const data = `<DataTemplate ${namespace}><TextBlock Name='label' Text='{Binding}'/></DataTemplate>`;
    const vm = create(`Button button = new Button { Name="owner", Content="Alpha", Foreground=new SolidColorBrush(Colors.Red) };
      button.Template = (ControlTemplate)XamlReader.Load(${JSON.stringify(template)});
      button.ContentTemplate = (DataTemplate)XamlReader.Load(${JSON.stringify(data)});
      Window window = new Window { Content=button }; window.Activate();`, Engine);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      const context = vm.platform.ui;
      context.flushContentPresenters();
      const owner = context.reference(vm.platform.scene().nodes.find(node => node.properties.Name === 'owner').id);
      const slot = getResourceServices(context).getTemplateChild(owner, 'slot');
      const label = context.read(slot, '$templateRoot');
      assert.equal(context.native(context.read(label, 'Text')), 'Alpha');
      assert.deepEqual(context.read(label, 'Foreground'), context.read(owner, 'Foreground'));
      const weak = vm.heap.createHandle(label, {weak: true});
      context.write(owner, 'Content', 'Beta');
      context.flushContentPresenters();
      const next = context.read(slot, '$templateRoot');
      assert.notDeepEqual(next, label);
      assert.equal(context.native(context.read(next, 'Text')), 'Beta');
      vm.heap.collect(); vm.heap.collect();
      assert.equal(vm.heap.getHandle(weak), null, 'replacing Content disconnects the old data-template binding');
      vm.heap.releaseHandle(weak);
      context.write(owner, 'ContentTemplate', null);
      context.write(owner, 'Content', null);
      context.flushContentPresenters();
      assert.equal(context.read(slot, '$templateRoot'), null);
      assert.equal(vm.heap.pins.length, 0);
      assert.equal(context.construction.size, 0);
    } finally { vm.stop(); }
  });

  test(`A15 ${Engine.name}: a failed construction releases its temporary managed roots`, () => {
    const vm = create('Console.WriteLine("ready");', Engine);
    try {
      assert.equal(vm.run().state, 'terminated');
      const context = vm.platform.ui;
      let weak;
      assert.throws(() => context.withConstruction(() => {
        const first = context.make('Microsoft.UI.Xaml.Controls.Border');
        weak = vm.heap.createHandle(first, {weak: true});
        context.withConstruction(() => context.make('Microsoft.UI.Xaml.Controls.Border'));
        vm.heap.collect();
        assert.ok(vm.heap.getHandle(weak), 'unfinished factory nodes remain alive through collections');
        throw new Error('factory failure');
      }), /factory failure/);
      assert.equal(context.construction.size, 0);
      assert.equal(vm.heap.pins.length, 0);
      vm.heap.collect();
      assert.equal(vm.heap.getHandle(weak), null, 'the failed factory does not leave persistent roots');
      vm.heap.releaseHandle(weak);
    } finally { vm.stop(); }
  });

  test(`A15 ${Engine.name}: XamlReader returns live controls and malformed XML produces a managed parse diagnostic`, () => {
    const valid = `<Button ${namespace} Content='Loaded'/>`;
    const invalid = `<Button ${namespace}><Grid></Button>`;
    const vm = create(`Button button = (Button)XamlReader.Load(${JSON.stringify(valid)}); Console.WriteLine(button.Content);
      try { XamlReader.Load(${JSON.stringify(invalid)}); }
      catch (XamlParseException error) { Console.WriteLine(error.Message.Contains("line"));
        Console.WriteLine(error.LineNumber > 0); Console.WriteLine(error.LinePosition > 0); }`, Engine);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, 'Loaded\nTrue\nTrue\nTrue\n');
    } finally { vm.stop(); }
  });
}
