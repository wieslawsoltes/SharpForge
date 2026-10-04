import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {AnimationClock} from '@sharpforge/framework';
import {CompositionTransportHost} from '@sharpforge/rendering';

const source = `using System; using System.Numerics; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Composition; using Microsoft.UI.Xaml.Hosting;
class Program {
  static SpriteVisual sprite;
  static CompositionScopedBatch batch;
  static void Main() {
    Button stop = new Button { Name = "stop", Content = "Stop opacity" };
    new Window { Content = stop }.Activate();
    Compositor compositor = ElementCompositionPreview.GetElementVisual(stop).Compositor;
    sprite = compositor.CreateSpriteVisual();
    sprite.Size = new Vector2(30, 20);
    ElementCompositionPreview.SetElementChildVisual(stop, sprite);
    Vector3KeyFrameAnimation move = compositor.CreateVector3KeyFrameAnimation();
    move.Target = "Offset"; move.Duration = TimeSpan.FromMilliseconds(100);
    move.InsertExpressionKeyFrame(0, "this.StartingValue");
    move.InsertExpressionKeyFrame(1, "this.FinalValue");
    ImplicitAnimationCollection implicitAnimations = compositor.CreateImplicitAnimationCollection();
    implicitAnimations.Insert("Offset", move); sprite.ImplicitAnimations = implicitAnimations;
    ScalarKeyFrameAnimation opacity = compositor.CreateScalarKeyFrameAnimation();
    opacity.Target = "Opacity"; opacity.Duration = TimeSpan.FromSeconds(1);
    opacity.InsertKeyFrame(0, 1); opacity.InsertKeyFrame(1, 0);
    ScalarKeyFrameAnimation rotation = compositor.CreateScalarKeyFrameAnimation();
    rotation.Target = "RotationAngle"; rotation.Duration = TimeSpan.FromMilliseconds(200);
    rotation.InsertKeyFrame(0, 0); rotation.InsertKeyFrame(1, 1);
    CompositionAnimationGroup group = compositor.CreateAnimationGroup();
    group.Add(opacity); group.Add(rotation);
    batch = compositor.CreateScopedBatch(CompositionBatchTypes.Animation);
    batch.Completed += (sender, args) => Console.WriteLine("batch-complete");
    sprite.Offset = new Vector3(20, 10, 0);
    sprite.StartAnimationGroup(group);
    batch.End();
    stop.Click += (sender, args) => sprite.StopAnimation("Opacity");
  }
}`;
let compiled;
function program() {
  if (!compiled) {
    compiled = compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  }
  return compiled;
}
const engines = {source: (built, options) => new VirtualMachine(built.image, options),
  reload: (built, options) => new VirtualMachine(loadAssembly(built.assembly), options),
  CIL: (built, options) => new CilVirtualMachine(built.assembly, options)};

for (const [engine, create] of Object.entries(engines)) {
  test(engine + ': implicit Offset and grouped timelines complete one managed batch after natural completion and explicit stop', async () => {
    const packets = [], completions = [], output = [];
    const vm = create(program(), {virtualTime: true, onOutput: value => output.push(value),
      onUIComposition: packet => packets.push(structuredClone(packet))});
    const transport = new CompositionTransportHost({clockFactory: adapter => new AnimationClock(adapter), onCompleted: token => {
      completions.push(token);
      vm.platform.ui.composition.complete(token);
    }});
    let cursor = 0;
    async function synchronize() {
      for (let turn = 0; turn < 32; turn++) {
        while (cursor < packets.length) {
          assert.ok(cursor < 256, 'The fixed fixture must not emit an unbounded transport sequence');
          transport.receive(packets[cursor++]);
        }
        if (['ready', 'running', 'waiting'].includes(vm.state)) vm.runSlice({instructionBudget: 4096, timeBudgetMs: 8});
        assert.notEqual(vm.state, 'faulted', JSON.stringify(vm.fault));
        await Promise.resolve();
      }
      assert.equal(cursor, packets.length);
    }
    try {
      const result = await vm.runAsync();
      assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
      await synchronize();
      const stop = vm.platform.scene().nodes.find(node => node.properties.Name === 'stop');
      const session = [...transport.sessions.values()].find(value => value.previews.has(stop.id));
      const sprite = session.previews.get(stop.id).child;
      assert.deepEqual(sprite.Offset, [0, 0, 0]);
      session.compositor.advance(50);
      assert.deepEqual(sprite.Offset, [10, 5, 0]);
      assert.equal(output.join(''), '');
      session.compositor.advance(50);
      await synchronize();
      assert.deepEqual(sprite.Offset, [20, 10, 0]);
      assert.equal(completions.length, 1);
      assert.equal(output.join(''), '');
      session.compositor.advance(100);
      await synchronize();
      assert.equal(sprite.RotationAngle, 1);
      assert.equal(completions.length, 2);
      assert.equal(output.join(''), '', 'The still-running grouped opacity prevents early batch completion');
      vm.platform.dispatchEvent(stop.id, 'Click', {});
      await synchronize();
      assert.equal(output.join(''), 'batch-complete\n');
      vm.platform.dispatchEvent(stop.id, 'Click', {});
      for (const token of completions) assert.equal(vm.platform.ui.composition.complete(token), false);
      await synchronize();
      assert.equal(output.join(''), 'batch-complete\n', 'Repeated stop and late completion do not deliver another batch event');
      assert.equal(session.compositor.animations.records.has(sprite.id + ':Opacity'), false);
    } finally { transport.dispose(); vm.stop(); }
  });
}
