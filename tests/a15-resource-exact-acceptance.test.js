import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly, formatILDocument, assembleILDocument} from '@sharpforge/cil';
import {types as frameworkTypes} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const imports = `using System; using System.Threading.Tasks; using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls; using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Markup;`;
const programs = new Map();
function program(source) {
  if (!programs.has(source)) {
    const built = compileToIL(imports + source);
    assert.equal(built.success, true, built.diagnostics.map(value => value.code + ': ' + value.message).join('\n'));
    programs.set(source, built);
  }
  return programs.get(source);
}

const options = {virtualTime: true, initialThreshold: 64};
const engines = {
  source: built => new VirtualMachine(built.image, {...options, bindingAssembly: built.assembly}),
  canonical: built => new VirtualMachine(loadAssembly(built.assembly), {...options, bindingAssembly: built.assembly}),
  cil: built => new CilVirtualMachine(built.assembly, options),
  reassembled: built => new CilVirtualMachine(assembleILDocument(formatILDocument(built.assembly)).bytes, options)
};

const dispatcherSource = `
class Program {
  static DispatcherQueue queue;
  static TextBlock label;
  static Task continuation;
  static void Record(string value) {
    label.Text = label.Text + value + "|";
    Console.WriteLine(value + ":" + queue.HasThreadAccess);
  }
  static void Low() { Record("L"); }
  static void Normal1() { Record("N1"); }
  static void Normal2() { Record("N2"); }
  static void High1() { Record("H1"); }
  static void High2() { Record("H2"); }
  static async Task EnqueueAfterDelay() {
    await Task.Delay(1);
    Console.WriteLine(queue.HasThreadAccess);
    Console.WriteLine(DispatcherQueue.GetForCurrentThread() == null);
    bool accepted = queue.TryEnqueue(DispatcherQueuePriority.Low, Low);
    accepted = queue.TryEnqueue(DispatcherQueuePriority.Normal, Normal1) && accepted;
    accepted = queue.TryEnqueue(DispatcherQueuePriority.High, High1) && accepted;
    accepted = queue.TryEnqueue(DispatcherQueuePriority.Normal, Normal2) && accepted;
    accepted = queue.TryEnqueue(DispatcherQueuePriority.High, High2) && accepted;
    Console.WriteLine(accepted);
  }
  static int BeginWorker() {
    continuation = EnqueueAfterDelay();
    return 0;
  }
  static async Task Main() {
    label = new TextBlock {Name = "status", Text = ""};
    Window window = new Window {Content = label};
    window.Activate();
    queue = label.DispatcherQueue;
    Console.WriteLine(queue.HasThreadAccess);
    await Task.Run(BeginWorker);
    await continuation;
  }
}`;

const userControlTemplate = `<ControlTemplate xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'
TargetType='UserControl'><Border Name='part' Width='17'/></ControlTemplate>`;
const userControlSource = `
class Derived : UserControl {
  public int Calls;
  public bool HasPart;
  protected override void OnApplyTemplate() {
    base.OnApplyTemplate();
    Calls++;
    HasPart = GetTemplateChild("part") is Border;
  }
}
class Program {
  static void Main() {
    Grid panel = new Grid {Name = "parent"};
    Derived child = new Derived {Name = "derived"};
    child.Template = (ControlTemplate)XamlReader.Load(${JSON.stringify(userControlTemplate)});
    panel.Children.Add(child);
    UserControl view = child;
    Console.WriteLine(Object.ReferenceEquals(view.Parent, panel));
    Console.WriteLine(view.ApplyTemplate());
    Console.WriteLine(child.Calls);
    Console.WriteLine(child.HasPart);
    Console.WriteLine(Object.ReferenceEquals(VisualTreeHelper.GetParent(VisualTreeHelper.GetChild(view, 0)), view));
    Console.WriteLine(view is Derived);
    Window window = new Window {Content = panel};
    window.Activate();
    Console.WriteLine(view.ApplyTemplate());
    Console.WriteLine(child.Calls);
  }
}`;

const markup = `<Grid xmlns='http://schemas.microsoft.com/winfx/2006/xaml/presentation'
Name='page' Width='320' Height='200' RowSpacing='3'>
  <StackPanel Name='stack' Spacing='6' Padding='4'>
    <TextBlock Name='title' Text='Hello &amp; goodbye' FontSize='18'/>
    <Button Name='action' Content='Save &amp; close' Width='120' Height='36'
      HorizontalAlignment='Left' IsEnabled='False'/>
  </StackPanel>
</Grid>`;
const activate = `Window window = new Window {Title = "Equivalent scene", Content = page}; window.Activate();`;
const xamlSource = `Grid page = (Grid)XamlReader.Load(${JSON.stringify(markup)}); ${activate}`;
const codeSource = `
  Grid page = new Grid {Name = "page", Width = 320.0, Height = 200.0, RowSpacing = 3.0};
  StackPanel stack = new StackPanel {Name = "stack", Spacing = 6.0, Padding = new Thickness(4.0)};
  TextBlock title = new TextBlock {Name = "title", Text = "Hello & goodbye", FontSize = 18.0};
  Button action = new Button {Name = "action", Content = "Save & close", Width = 120.0, Height = 36.0,
    HorizontalAlignment = HorizontalAlignment.Left, IsEnabled = false};
  stack.Children.Add(title); stack.Children.Add(action); page.Children.Add(stack);
  ${activate}`;

// Preserve the complete scene. Allocation identities and local-marker insertion order are not visual state.
function canonicalScene(scene) {
  const identities = new Map(scene.nodes.map((node, index) => [node.id, 'node:' + index]));
  let external = 0;
  const identity = id => {
    if (!identities.has(id)) identities.set(id, 'value:' + external++);
    return identities.get(id);
  };
  const value = item => {
    if (Array.isArray(item)) return item.map(value);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item).sort().map(key =>
      [key, key === '$ref' ? identity(item[key]) : value(item[key])]));
  };
  return {...scene, windows: scene.windows.map(identity), nodes: scene.nodes.map(node => {
    const result = value(node);
    result.id = identity(node.id);
    result.localProperties = [...node.localProperties].sort();
    if (node.templateRoot !== undefined) result.templateRoot = identity(node.templateRoot);
    if (node.templateOwner !== undefined) result.templateOwner = identity(node.templateOwner);
    return result;
  })};
}

for (const [engine, create] of Object.entries(engines)) {
  test(`A15 ${engine}: Task continuation enqueues real UI callbacks in priority and FIFO order`, async () => {
    const vm = create(program(dispatcherSource));
    try {
      const result = await vm.runAsync();
      assert.equal(result.state, 'terminated', result.fault?.stack ?? result.fault?.message);
      assert.equal(vm.output.join(''), 'True\nFalse\nTrue\nTrue\nH1:True\nH2:True\nN1:True\nN2:True\nL:True\n');
      const label = vm.platform.scene().nodes.find(node => node.properties.Name === 'status');
      assert.equal(label.properties.Text, 'H1|H2|N1|N2|L|');
      assert.equal(vm.heap.pins.length, 0);
    } finally { vm.stop(); }
  });

  test(`A15 ${engine}: a Derived UserControl is parented and receives its actual template override`, async () => {
    const registeredTypes = frameworkTypes.size;
    assert.equal(frameworkTypes.has('Derived'), false);
    const vm = create(program(userControlSource));
    try {
      const result = await vm.runAsync();
      assert.equal(result.state, 'terminated', result.fault?.stack ?? result.fault?.message);
      assert.equal(result.output, 'True\nTrue\n1\nTrue\nTrue\nTrue\nFalse\n1\n');
      const child = vm.platform.scene().nodes.find(node => node.properties.Name === 'derived');
      assert.equal(child.managedType, 'Derived');
      assert.equal(child.type, 'Microsoft.UI.Xaml.Controls.UserControl');
      assert.equal(frameworkTypes.has('Derived'), false, 'user image types must not open the global framework registry');
      assert.equal(frameworkTypes.size, registeredTypes);
    } finally { vm.stop(); }
  });

  test(`A15 ${engine}: XAML and equivalent code-first Grid StackPanel Button scenes are equal`, async () => {
    const xaml = create(program(xamlSource));
    const code = create(program(codeSource));
    try {
      for (const vm of [xaml, code]) {
        const result = await vm.runAsync();
        assert.equal(result.state, 'terminated', result.fault?.stack ?? result.fault?.message);
      }
      const loaded = xaml.platform.scene(), constructed = code.platform.scene();
      assert.equal(loaded.windows.length, 1);
      for (const name of ['page', 'stack', 'title', 'action']) {
        assert(loaded.nodes.some(node => node.properties.Name === name), 'live scene contains ' + name);
      }
      const button = loaded.nodes.find(node => node.properties.Name === 'action');
      assert.equal(button.properties.Content, 'Save & close');
      assert.equal(button.properties.IsEnabled, false);
      assert.equal(button.properties.Width, 120);
      assert.deepEqual(canonicalScene(loaded), canonicalScene(constructed));
    } finally { xaml.stop(); code.stop(); }
  });
}
