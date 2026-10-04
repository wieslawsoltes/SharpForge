import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {ownsHeapReference} from '../packages/runtime/src/execution/heap-reference.js';

test('source named animation targets remain owned roots across local and portable snapshots', async () => {
  const compiled = compileToIL(`
    using System;
    using Microsoft.UI.Xaml;
    using Microsoft.UI.Xaml.Controls;
    using Microsoft.UI.Xaml.Media.Animation;
    var button = new Button(){Name="target",Opacity=0.7};
    var window = new Window();window.Content=button;window.Activate();
    var animation = new DoubleAnimation(){From=0,To=1,Duration=new Duration(TimeSpan.FromSeconds(1))};
    Storyboard.SetTargetName(animation,"target");Storyboard.SetTargetProperty(animation,"Opacity");
    var storyboard = new Storyboard();storyboard.Children.Add(animation);storyboard.Begin();
    SharpForge.UI.AnimationClock.AdvanceBy(250);
  `);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  const vm = new VirtualMachine(compiled.image);
  const result = vm.run();
  assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
  const target = [...vm.platform.animations.bases.values()][0].target;
  assert(ownsHeapReference(vm.heap, target));
  const saved = vm.snapshot(), wire = await serializeSnapshot(vm, saved);
  vm.platform.animations.advance(500);
  vm.restore(saved);
  assert.equal(vm.platform.native(vm.platform.get(target, 'Opacity')), 0.25);
  const fresh = new VirtualMachine(compiled.image);
  await restoreSerializedSnapshot(fresh, wire);
  const restoredTarget = [...fresh.platform.animations.bases.values()][0].target;
  assert(ownsHeapReference(fresh.heap, restoredTarget));
  fresh.platform.animations.advance(500);
  assert.equal(fresh.platform.native(fresh.platform.get(restoredTarget, 'Opacity')), 0.75);
});
