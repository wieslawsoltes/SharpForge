import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {AnimationClock} from '@sharpforge/framework';
import {Compositor, CompositionServices, CompositionTransportHost, ImplicitTransition} from '@sharpforge/rendering';

const clockFactory = adapter => new AnimationClock(adapter);
const composition = 'Microsoft.UI.Composition.';
const hosting = 'Microsoft.UI.Xaml.Hosting.ElementCompositionPreview';
const engines = {
  source: built => new VirtualMachine(built.image),
  canonical: built => new VirtualMachine(loadAssembly(built.assembly)),
  CIL: built => new CilVirtualMachine(built.assembly)
};

for (const [name, create] of Object.entries(engines)) {
  test(name + ': full heap GC releases preview owners and independently created compositors', () => {
    const built = compileToIL('Console.WriteLine("ready");');
    assert.equal(built.success, true, JSON.stringify(built.diagnostics));
    const vm = create(built);
    assert.equal(vm.run().state, 'terminated');
    const context = vm.platform.ui;
    const initialPins = vm.heap.pins.length;
    const owner = context.make('Microsoft.UI.Xaml.Controls.Button', []);
    assert.equal(vm.heap.pins.length, initialPins, 'Native constructor scratch roots end at the factory boundary');
    const ownerHandle = vm.heap.createHandle(owner);
    const result = context.invoke({owner: hosting, kind: 'method', name: 'GetElementVisual', isStatic: true,
      parameters: ['Microsoft.UI.Xaml.UIElement'], result: composition + 'Visual'}, [owner]);
    assert.equal(result.handled, true);
    const visual = context.unwrapModel(result.value);
    const other = context.make(composition + 'Compositor', []);
    assert.equal(vm.heap.pins.length, initialPins, 'Registered constructors preserve the caller scratch-root depth');
    const native = context.unwrapModel(other);
    const child = native.CreateSpriteVisual();
    const childReference = context.wrapModel(child, composition + 'SpriteVisual');
    const childHandle = vm.heap.createHandle(childReference);
    vm.heap.collect();
    assert.equal(context.isAlive(owner), true);
    assert.equal(context.isAlive(result.value), true);
    assert.equal(context.isAlive(other), true, 'A live child retains its compositor');
    vm.heap.releaseHandle(ownerHandle);
    vm.heap.releaseHandle(childHandle);
    vm.heap.collect();
    context.prune();
    assert.equal(context.isAlive(owner), false);
    assert.equal(context.isAlive(result.value), false);
    assert.equal(context.isAlive(other), false);
    assert.equal(visual.closed, true);
    assert.equal(native.closed, true);
    assert.equal(context.composition.elementCompositionPreview.entries.size, 0);
    vm.stop();
  });
}

test('brush transition transport updates host paint without sending frame values and clears its binding on completion', async () => {
  const packets = [];
  const bindings = new Map();
  const host = new CompositionTransportHost({clockFactory,
    setBrush: (id, property, brush) => bindings.set(id + ':' + property, brush)});
  const owner = {id: 'button'};
  const service = new CompositionServices({clockFactory, emit: packet => { packets.push(structuredClone(packet)); host.receive(packet); },
    session: 'brush-session', preview: {isElement: value => value === owner},
    implicit: {getTransition: () => new ImplicitTransition('BrushTransition', 100), getColorBrush: value => value}});
  service.propertyChanged(owner, 'Background', [1, 0, 0, 1], [0, 0, 1, 1]);
  const brush = bindings.get('button:Background');
  assert.ok(brush);
  const count = packets.length;
  const localHost = [...host.sessions.values()][0].compositor;
  localHost.advance(50);
  assert.ok(brush.Color[0] > 0 && brush.Color[2] > 0);
  assert.equal(packets.length, count, 'Host animation does not emit managed property packets');
  const saved = host.snapshot();
  localHost.advance(50);
  host.restore(saved);
  assert.equal(bindings.get('button:Background'), brush);
  service.compositor.advance(100);
  assert.equal(bindings.get('button:Background'), null);
  assert.throws(() => host.receive({version: 1, session: 'brush-session:1', op: 'composition-brush',
    elementId: 'button', property: '__proto__', brushId: null}), /brush binding/);
  await service.dispose();
  host.dispose();
});

test('disposed visual and brush release retained resource handles before application shutdown', async () => {
  const compositor = new Compositor({clockFactory});
  for (let index = 0; index < 20; index++) {
    const visual = compositor.CreateSpriteVisual();
    const brush = compositor.CreateColorBrush([1, 0, 0, 1]);
    visual.Size = [20, 20];
    visual.Brush = brush;
    compositor.layerFor(visual);
    assert.equal(compositor.resources.liveCount, 2);
    visual.dispose();
    brush.dispose();
    assert.equal(compositor.resources.liveCount, 0);
    assert.equal(compositor.objects.size, 0);
  }
  await compositor.dispose();
});
