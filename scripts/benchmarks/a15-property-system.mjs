import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {beginAllocation, finishAllocation} from '../conformance/perf/alloc.js';

const count = 1000;
const prefix = 'using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls; using Microsoft.UI.Xaml.Data;';
const sources = Object.freeze({
  set: {source: `Button target = new Button();
    for (int i = 0; i < ${count}; i++) target.SetValue(Button.WidthProperty, (double)i);
    Console.WriteLine(target.Width);`, output: '999\n', operations: count},
  clear: {source: `Button target = new Button();
    for (int i = 0; i < ${count}; i++) { target.SetValue(Button.WidthProperty, 17.0); target.ClearValue(Button.WidthProperty); }
    Console.WriteLine(target.ReadLocalValue(Button.WidthProperty) == DependencyProperty.UnsetValue);`, output: 'True\n', operations: count * 2},
  'style-refresh': {source: `Button target = new Button();
    Style first = new Style("Button"); first.Setters.Add(new Setter(Button.WidthProperty, 17.0));
    Style second = new Style("Button"); second.Setters.Add(new Setter(Button.WidthProperty, 29.0));
    for (int i = 0; i < ${count}; i++) target.Style = i % 2 == 0 ? first : second;
    Console.WriteLine(target.Width);`, output: '29\n', operations: count},
  'binding-update': {source: `class Source : Control, System.ComponentModel.INotifyPropertyChanged {
      private string title = "first";
      public event System.ComponentModel.PropertyChangedEventHandler PropertyChanged;
      public string Title { get { return title; } set { title = value;
        PropertyChanged?.Invoke(this, new System.ComponentModel.PropertyChangedEventArgs("Title")); } }
    }
    class P { static void Main() {
      Source source = new Source(); TextBlock target = new TextBlock();
      target.SetBinding(TextBlock.TextProperty, new Binding { Source = source, Path = new PropertyPath("Title"), Mode = BindingMode.OneWay });
      for (int i = 0; i < ${count}; i++) source.Title = i % 2 == 0 ? "even" : "odd";
      Console.WriteLine(target.Text);
    } }`, output: 'odd\n', operations: count}
});

/** Pinned registry adapter: compilation occurs once; samples include authoritative managed property and scene operations. */
export async function create({root, adapter}) {
  const fixture = sources[adapter.scope];
  if (!fixture || !['source', 'cil'].includes(adapter.engine)) throw new Error('Unsupported A15 property benchmark');
  const from = name => import(pathToFileURL(join(root, 'packages', name, 'src/index.js')).href);
  const [{compileToIL}, {VirtualMachine, CilVirtualMachine}] = await Promise.all([from('compiler'), from('runtime')]);
  const built = compileToIL(prefix + fixture.source);
  assert.equal(built.success, true, JSON.stringify(built.diagnostics));
  return () => {
    const options = {bindingAssembly: built.assembly, maxSteps: 10000000};
    const vm = adapter.engine === 'source' ? new VirtualMachine(built.image, options) : new CilVirtualMachine(built.assembly, options);
    const before = beginAllocation(vm), start = performance.now(), result = vm.run(), ms = performance.now() - start;
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(result.output, fixture.output);
    return {ms, checksum: adapter.scope + ':' + fixture.output,
      metrics: {...finishAllocation(before, vm, fixture.operations), operations: fixture.operations,
        operationsPerSecond: ms === 0 ? null : fixture.operations * 1000 / ms}};
  };
}
