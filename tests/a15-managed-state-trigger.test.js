import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const source = `using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
  Probe trigger = new Probe();
  VisualState active = new VisualState {Name = "On"}; active.StateTriggers.Add(trigger);
  VisualState fallback = new VisualState {Name = "Off"}; fallback.StateTriggers.Add(new StateTrigger {IsActive = true});
  VisualStateGroup group = new VisualStateGroup {Name = "ProbeStates"}; group.States.Add(active); group.States.Add(fallback);
  Control owner = new Button {Name = "owner", Tag = trigger, Template = new ControlTemplate()};
  owner.ApplyTemplate();
  VisualStateManager.GetVisualStateGroups(owner).Add(group);
  Console.WriteLine(VisualStateManager.GoToState(owner, "Off", false));
  trigger.Toggle(true); Console.WriteLine(group.CurrentState.Name);
  trigger.Toggle(false); Console.WriteLine(group.CurrentState.Name);
  Window window = new Window {Content = owner}; window.Activate();
  public class Probe : StateTriggerBase { public void Toggle(bool value) { SetActive(value); } }`;

for (const Engine of [VirtualMachine, CilVirtualMachine]) {
  test(`A15 ${Engine.name}: a managed custom StateTriggerBase controls state and disconnects on disposal`, () => {
    const built = compileToIL(source, {includeDebug: false});
    assert.equal(built.success, true, built.diagnostics.map(item => item.message).join('\n'));
    const vm = new Engine(Engine === VirtualMachine ? built.image : built.assembly, {initialThreshold: 4096});
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, 'True\nOn\nOff\n');
      const context = vm.platform.ui;
      const owner = context.reference(vm.platform.scene().nodes.find(node => node.properties.Name === 'owner').id);
      const trigger = context.state(context.read(owner, 'Tag'), 'stateTrigger');
      const manager = context.state(owner, 'visualStateManager');
      assert.equal(trigger.listeners.size, 1);
      manager.dispose();
      assert.equal(trigger.listeners.size, 0);
      trigger.setActive(true);
      assert.equal(manager.disposed, true);
    } finally { vm.stop(); }
  });
}
