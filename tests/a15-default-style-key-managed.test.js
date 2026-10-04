import test from 'node:test';
import assert from 'node:assert/strict';
import {compilePropertyFixture, propertyEngines} from './helpers/a15-property-managed-fixture.js';

const source = `using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
class Alternate : Button {}
class Keyed : Button {
  public void Choose(object key) { DefaultStyleKey = key; }
  public void ResetKey() { ClearValue(DefaultStyleKeyProperty); }
}
class Program {
  static Style Sized(double height) {
    Style style = new Style(typeof(Keyed));
    style.Setters.Add(new Setter(FrameworkElement.MinHeightProperty, height));
    return style;
  }
  static void Main() {
    Keyed control = new Keyed {Name = "keyed"};
    control.Resources.Add("compact", Sized(11.0));
    control.Resources.Add(typeof(Alternate), Sized(17.0));
    control.Resources.Add("invalid", new Style(typeof(TextBlock)));
    Window window = new Window {Content = control};
    window.Activate();
    Console.WriteLine(control.MinHeight);
    control.Choose("compact"); Console.WriteLine(control.MinHeight);
    control.Style = Sized(21.0); Console.WriteLine(control.MinHeight);
    control.MinHeight = 31.0;
    control.Resources["compact"] = Sized(13.0); Console.WriteLine(control.MinHeight);
    control.ClearValue(FrameworkElement.MinHeightProperty); Console.WriteLine(control.MinHeight);
    control.ClearValue(FrameworkElement.StyleProperty); Console.WriteLine(control.MinHeight);
    control.Choose("absent"); Console.WriteLine(control.MinHeight);
    control.Choose(null); Console.WriteLine(control.MinHeight);
    control.ResetKey(); Console.WriteLine(control.MinHeight);
    control.Choose(typeof(Alternate)); Console.WriteLine(control.MinHeight);
    control.Choose(typeof(Button)); Console.WriteLine(control.MinHeight);
    control.Choose("compact"); Console.WriteLine(control.MinHeight);
  }
}`;

test('A15 managed DefaultStyleKey lookup, replacement, fallback and owner lifetime', async t => {
  const built = compilePropertyFixture(source);
  for (const [name, vm] of propertyEngines(built)) {
    await t.test(name, async () => {
      const pins = vm.heap.pins.length;
      try {
        const result = await vm.runAsync();
        assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
        assert.equal(result.output, '32\n11\n21\n31\n21\n13\n0\n0\n32\n17\n32\n13\n');
        const scene = vm.platform.scene();
        const node = scene.nodes.find(candidate => candidate.properties.Name === 'keyed');
        const context = vm.platform.ui;
        const owner = context.reference(node.id);
        const scope = context.resourceScopeFor(owner);
        const application = context.state(owner, 'styleApplication');
        const subscription = application.defaultResource.subscription;
        const observers = scope.observers.size;
        assert.throws(() => context.write(owner, 'DefaultStyleKey', 'invalid'), /incompatible/);
        assert.equal(context.native(context.read(owner, 'DefaultStyleKey')), 'compact');
        assert.equal(context.native(context.read(owner, 'MinHeight')), 13);
        assert.equal(application.defaultResource.subscription, subscription);
        assert.equal(scope.observers.size, observers);
        vm.heap.collect();
        assert.equal(context.native(context.read(owner, 'MinHeight')), 13);
        const window = context.reference(scene.windows[0]);
        context.write(window, 'Content', null);
        vm.heap.collect();
        assert.equal(scope.disposed, true);
        assert.equal(scope.observers.size, 0);
        assert.equal(scope.resources.listeners.size, 0);
        assert.equal(vm.heap.pins.length, pins);
      } finally { vm.stop(); }
    });
  }
});
