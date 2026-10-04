import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {FrameworkMembers} from '../packages/compiler/src/binder/framework-members.js';
import {isRegisteredReferenceUpcast} from '../packages/compiler/src/conversions/registered-reference.js';

const prefix = 'using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls; using Microsoft.UI.Xaml.Media;';
const engines = {source: result => new VirtualMachine(result.image), cil: result => new CilVirtualMachine(result.assembly)};
const programs = [
  {
    name: 'base locals and assignments retain identity and inherited property dispatch',
    source: `
      var button = new Button();
      ContentControl content = button;
      content.Content = "first";
      FrameworkElement element = button;
      element.Name = "registered";
      content = button;
      Console.WriteLine(button.Content);
      Console.WriteLine(content.Name);
      Console.WriteLine(Object.ReferenceEquals(button, content));
      Console.WriteLine(Object.ReferenceEquals(content, element));
    `,
    output: 'first\nregistered\nTrue\nTrue\n'
  },
  {
    name: 'base parameters and returns keep the same derived object',
    source: `
      class Program {
        static ContentControl Create() { return new Button(); }
        static FrameworkElement Echo(FrameworkElement value) { return value; }
        static void Main() {
          ContentControl content = Create();
          FrameworkElement element = Echo(content);
          element.Name = "returned";
          content.Content = "content";
          Console.WriteLine(content.Name);
          Console.WriteLine(content.Content);
          Console.WriteLine(Object.ReferenceEquals(content, element));
        }
      }
    `,
    output: 'returned\ncontent\nTrue\n'
  },
  {
    name: 'typed null upcasts preserve null and receiver faults',
    source: `
      Button button = null;
      ContentControl content = button;
      Console.WriteLine(Object.ReferenceEquals(content, null));
      try { content.Content = "unused"; }
      catch (Exception error) { Console.WriteLine(error.GetType().Name); }
    `,
    output: 'True\nNullReferenceException\n'
  },
  {
    name: 'framework parameters and properties accept registered derived classes',
    source: `
      var button = new Button();
      Grid.SetRow(button, 7);
      var border = new Border();
      border.Child = button;
      Console.WriteLine(Grid.GetRow(button));
      Console.WriteLine(Object.ReferenceEquals(button, border.Child));
    `,
    output: '7\nTrue\n'
  }
];

for (const pipeline of ['bound', 'legacy']) {
  for (const [engine, create] of Object.entries(engines)) {
    for (const program of programs) {
      test(`registered base reference ${pipeline}/${engine}: ${program.name}`, () => {
        const result = compileToIL(prefix + program.source, {pipeline});
        assert.equal(result.success, true, JSON.stringify(result.diagnostics));
        const vm = create(result);
        try {
          const actual = vm.run();
          assert.equal(actual.state, 'terminated', actual.fault?.stack);
          assert.equal(actual.output, program.output);
        } finally { vm.stop(); }
      });
    }
  }
}

test('registered base reference: framework binding keeps unrelated and value arguments rejected', () => {
  const members = new FrameworkMembers();
  const candidates = members.methods('Microsoft.UI.Xaml.Controls.Grid', 'GetRow', true);
  const resolve = type => members.resolve(candidates, [{type: members.typeOf(type)}], {name: 'GetRow'});
  assert.equal(resolve('Microsoft.UI.Xaml.Controls.Button').succeeded, true);
  for (const type of ['object', 'int', 'Microsoft.UI.Xaml.Thickness', 'Microsoft.UI.Xaml.Media.SolidColorBrush']) {
    assert.equal(resolve(type).succeeded, false, type);
  }
});

test('registered base reference: implicit downcasts, unrelated types and value conversions remain errors', () => {
  for (const source of [
    'ContentControl content = new Button(); Button button = content;',
    'Button button = new TextBox();',
    'ContentControl content = new Thickness(1);',
    'object boxed = new Thickness(1); ContentControl content = boxed;'
  ]) {
    const result = compileToIL(prefix + source);
    assert.equal(result.success, false, source);
    assert.equal(result.image, null);
    assert(result.diagnostics.some(item => item.severity === 'error'), JSON.stringify(result.diagnostics));
  }
});

test('registered base reference: explicit downcasts still require an unsupported runtime type check', () => {
  const result = compileToIL(prefix + `
    ContentControl content = new Button();
    Button button = (Button)content;
    Console.WriteLine(button.Content);
  `);
  assert.equal(result.success, false);
  assert.equal(result.image, null);
  assert(result.diagnostics.some(item => item.code === 'SF2200'), JSON.stringify(result.diagnostics));
});

test('registered base reference: the shared predicate preserves interface, value and unregistered-type boundaries', () => {
  const button = 'Microsoft.UI.Xaml.Controls.Button';
  const content = 'Microsoft.UI.Xaml.Controls.ContentControl';
  assert.equal(isRegisteredReferenceUpcast(button, content), true);
  assert.equal(isRegisteredReferenceUpcast(button, 'Microsoft.UI.Xaml.DependencyObject'), true);
  assert.equal(isRegisteredReferenceUpcast('System.StringComparer', 'System.Collections.Generic.IComparer`1<string>'), true);
  for (const [source, target] of [
    [content, button],
    ['Microsoft.UI.Xaml.Controls.TextBox', button],
    ['Microsoft.UI.Xaml.Thickness', 'System.ValueType'],
    ['Microsoft.UI.Xaml.Controls.Orientation', 'System.Enum'],
    ['int', content],
    ['object', content],
    ['Microsoft.UI.Colors', content],
    ['User.Derived', 'User.Base'],
    [button, 'User.Base'],
    ['User.Derived', content],
    ['System.StringComparer', 'System.Collections.Generic.IComparer`1<object>'],
    [null, content],
    [button, undefined]
  ]) {
    assert.equal(isRegisteredReferenceUpcast(source, target), false, `${source} -> ${target}`);
  }
});
