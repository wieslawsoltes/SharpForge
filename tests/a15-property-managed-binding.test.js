import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {loadAssembly, formatILDocument, assembleILDocument} from '@sharpforge/cil';
import {createContextXamlLoader} from '@sharpforge/winui-properties';

const prefix = `using System; using System.ComponentModel; using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls; using Microsoft.UI.Xaml.Data;`;
const sourceClass = `class BindingSource : Control, INotifyPropertyChanged {
  private string title = "first";
  public event PropertyChangedEventHandler PropertyChanged;
  public string Title { get { return title; } set { title = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs("Title")); } }
  public string Format(string value) { return "[" + value + "]"; }
  public void Refresh() { PropertyChanged?.Invoke(this, new PropertyChangedEventArgs("")); }
}`;
const engines = {
  source: built => new VirtualMachine(built.image, {initialThreshold: 64, bindingAssembly: built.assembly}),
  canonical: built => new VirtualMachine(loadAssembly(built.assembly), {initialThreshold: 64, bindingAssembly: built.assembly}),
  cil: built => new CilVirtualMachine(built.assembly, {initialThreshold: 64}),
  reassembled: built => new CilVirtualMachine(assembleILDocument(formatILDocument(built.assembly)).bytes, {initialThreshold: 64})
};

function build(source) {
  const built = compileToIL(prefix + source);
  assert.equal(built.success, true, built.diagnostics.map(value => value.code + ': ' + value.message).join('\n'));
  return built;
}

test('A15 managed INPC updates general bindings through property and all-property notifications in every engine', () => {
  const built = build(sourceClass + `class P { static void Main() {
    BindingSource source = new BindingSource(); TextBlock target = new TextBlock();
    Binding binding = new Binding { Source = source, Path = new PropertyPath("Title"), Mode = BindingMode.OneWay };
    target.SetBinding(TextBlock.TextProperty, binding); Console.WriteLine(target.Text);
    source.Title = "second"; Console.WriteLine(target.Text); source.Refresh(); Console.WriteLine(target.Text);
    GC.Collect(); source.Title = "after collection"; Console.WriteLine(target.Text);
  } }`);
  for (const [name, create] of Object.entries(engines)) {
    const result = create(built).run();
    assert.equal(result.state, 'terminated', name + ': ' + JSON.stringify(result.fault));
    assert.equal(result.output, 'first\nsecond\nsecond\nafter collection\n', name);
  }
});

test('A15 XAML x:Bind compiles real source/member metadata and StopTracking stops managed updates', () => {
  const built = build(sourceClass + `class P { static void Main() {
    BindingSource source = new BindingSource(); source.Name = "source";
    Window window = new Window { Content = source }; window.Activate();
  } }`);
  for (const [name, create] of Object.entries(engines)) {
    const vm = create(built), result = vm.run();
    assert.equal(result.state, 'terminated', name + ': ' + JSON.stringify(result.fault));
    const context = vm.platform.ui;
    const sourceNode = vm.platform.scene().nodes.find(node => node.properties.Name === 'source');
    assert(sourceNode, name + ': rooted code-behind object');
    const source = context.reference(sourceNode.id);
    const loader = createContextXamlLoader(context);
    const loaded = loader.writer.load(`<TextBlock xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
      xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Text="{x:Bind Format(Title), Mode=OneWay}" />`, {root: source});
    const handle = vm.heap.createHandle(loaded.root);
    try {
      assert.equal(context.native(context.read(loaded.root, 'Text')), '[first]', name);
      const member = context.bindingServices.members.named(source, 'Title');
      context.bindingServices.members.write(source, member, 'changed');
      assert.equal(context.native(context.read(loaded.root, 'Text')), '[changed]', name);
      context.getCompiledBindings(source).StopTracking();
      context.bindingServices.members.write(source, member, 'stopped');
      assert.equal(context.native(context.read(loaded.root, 'Text')), '[changed]', name);
      context.getCompiledBindings(source).Update();
      assert.equal(context.native(context.read(loaded.root, 'Text')), '[stopped]', name);
    } finally { loaded.lifetime.dispose(); vm.heap.releaseHandle(handle); }
  }
});
