import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {ResourceScope, initializeResourceContext} from '@sharpforge/winui-properties';
import {EnvironmentState} from '@sharpforge/winui-controls';
import {resourceTargetType} from '../packages/winui-properties/src/object-model/resource-target-type.js';

test('A15 resource target types distinguish a typed value, an empty managed string and a legacy type name', () => {
  const type = {kind: 'runtime-type', name: 'Microsoft.UI.Xaml.Controls.Button'};
  const text = {kind: 'managed-string', value: ''};
  const calls = [];
  const context = {
    read: (owner, name) => owner[name],
    native: value => value?.kind === 'managed-string' ? value.value : value,
    typeName(value) {
      calls.push(value);
      if (value === type) return value.name;
      assert.equal(typeof value, 'string');
      assert.notEqual(value, '');
      return value;
    }
  };
  assert.equal(resourceTargetType(context, {TargetTypeName: text}), null);
  assert.equal(calls.length, 0);
  assert.equal(resourceTargetType(context, {TargetType: type, TargetTypeName: text}), type.name);
  assert.equal(calls[0], type, 'the actual System.Type is decoded directly');
  assert.equal(resourceTargetType(context, {TargetTypeName: {kind: 'managed-string', value: type.name}}), type.name);
});

test('A15 template detach after scope disposal does not recreate resources against a disposed environment', () => {
  const environment = new EnvironmentState(), owner = {}, parent = new ResourceScope();
  const scope = new ResourceScope({owner, parent});
  let factories = 0, parents = 0;
  const context = {
    services: {environment},
    state(reference, key, factory) {
      if (reference === owner && key === 'resourceScope') return scope;
      if (factory) { factories++; return factory(); }
      return undefined;
    },
    parentOf() { parents++; return null; },
    getApplication: () => null
  };
  initializeResourceContext(context, {children: () => []});
  environment.dispose();
  parent.dispose();
  assert.equal(scope.disposed, true);
  assert.doesNotThrow(() => context.resourceParentChanged(owner));
  assert.equal(parents, 0);
  assert.equal(factories, 0);
  assert.equal(environment.listeners.size, 0);
});

for (const Engine of [VirtualMachine, CilVirtualMachine]) {
  test(`A15 ${Engine.name}: template target getters preserve typed and released string declarations`, () => {
    const built = compileToIL(`using System; using Microsoft.UI.Xaml.Controls;
      ControlTemplate empty = new ControlTemplate(); Console.WriteLine(empty.TargetType == null);
      empty.VisualTree = new Border {Name = "part"};
      Button first = new Button {Template = empty}; first.ApplyTemplate(); Console.WriteLine(first.FindName("part") != null);
      ControlTemplate typed = new ControlTemplate {TargetType = typeof(Button)};
      Console.WriteLine(typed.TargetType.Name);
      typed.VisualTree = new Border {Name = "typedPart"}; Button second = new Button {Template = typed};
      second.ApplyTemplate(); Console.WriteLine(second.FindName("typedPart") != null);
      ControlTemplate legacy = new ControlTemplate {TargetTypeName = "Microsoft.UI.Xaml.Controls.Button"};
      Console.WriteLine(legacy.TargetType.Name);
      legacy.VisualTree = new Border {Name = "legacyPart"}; Button third = new Button {Template = legacy};
      third.ApplyTemplate(); Console.WriteLine(third.FindName("legacyPart") != null);
    `, {includeDebug: false});
    assert.equal(built.success, true, built.diagnostics.map(item => item.message).join('\n'));
    const vm = new Engine(Engine === VirtualMachine ? built.image : built.assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, 'True\nTrue\nButton\nTrue\nButton\nTrue\n');
    } finally { vm.stop(); }
  });
}
