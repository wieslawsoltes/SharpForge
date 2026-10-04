import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = `using Microsoft.UI;
using Microsoft.UI.Composition;
class Program {
  static CompositionLinearGradientBrush gradient;
  static ContainerVisual parent;
  static ShapeVisual shapes;
  static void Initialize() {
    var compositor = new Compositor();
    gradient = compositor.CreateLinearGradientBrush();
    gradient.ColorStops.Add(compositor.CreateColorGradientStop(0, Colors.Red));
    gradient.ColorStops.Add(compositor.CreateColorGradientStop(1, Colors.Blue));
    parent = compositor.CreateContainerVisual();
    parent.Children.InsertAtTop(compositor.CreateSpriteVisual());
    shapes = compositor.CreateShapeVisual();
    shapes.Shapes.Add(compositor.CreateSpriteShape(compositor.CreateRectangleGeometry()));
  }
  static void Main() { Initialize(); GC.Collect(); Console.WriteLine("ready"); }
}`;
let build;
function compiled() {
  build ??= compileToIL(source);
  assert.equal(build.success, true, JSON.stringify(build.diagnostics));
  return build;
}

const engines = {
  source: value => new VirtualMachine(value.image, {virtualTime: true}),
  reload: value => new VirtualMachine(loadAssembly(value.assembly), {virtualTime: true}),
  CIL: value => new CilVirtualMachine(value.assembly, {virtualTime: true})
};

for (const [name, create] of Object.entries(engines)) {
  test(name + ': retained composition collection wrappers keep later items alive and release removed items', async () => {
    const vm = create(compiled());
    try {
      const result = await vm.runAsync();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, 'ready\n');
      const context = vm.platform.ui;
      const models = [...context.modelState.owners.values()].map(owner => owner.states.get('nativeModel')?.value).filter(Boolean);
      const gradient = models.find(model => model.kind === 'CompositionLinearGradientBrush');
      const parent = models.find(model => model.kind === 'ContainerVisual');
      const shapes = models.find(model => model.kind === 'ShapeVisual');
      for (const [model, property] of [[gradient, 'ColorStops'], [parent, 'Children'], [shapes, 'Shapes']]) {
        const collection = model[property];
        const reference = context.modelReferences.get(collection);
        assert.equal(context.isAlive(reference), true, property + ' wrapper');
        const items = [...collection];
        assert.ok(items.length > 0);
        for (const item of items) {
          assert.equal(item.closed, false, property + ' item remains usable');
          assert.equal(context.isAlive(context.modelReferences.get(item)), true, property + ' item wrapper');
        }
        const method = property === 'Children' ? 'RemoveAll' : 'Clear';
        context.invoke({owner: 'Microsoft.UI.Composition.' + collection.kind, kind: 'method', name: method,
          parameters: [], result: 'void'}, [reference]);
        vm.heap.collect();
        context.modelState.prune();
        for (const item of items) assert.equal(item.closed, true, property + ' removed item releases its native model');
        assert.equal(context.isAlive(reference), true, property + ' empty collection remains owned');
      }
      assert.equal(gradient.descriptor().ColorStops.length, 0);
    } finally { vm.stop(); }
  });
}
