import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '@sharpforge/compiler';
import {frameworkBridge} from '../packages/compiler/src/symbols/registry-bridge.js';
import {compilePropertyFixture, propertyEngines} from './helpers/a15-property-managed-fixture.js';

test('A15 registered enum fields preserve public numeric constants and carry their declaring enum type', () => {
  const bridge = frameworkBridge();
  for (const [owner, name, value] of [
    ['Microsoft.UI.Xaml.Data.BindingMode', 'OneWay', 1],
    ['System.Collections.Specialized.NotifyCollectionChangedAction', 'Replace', 2],
    ['Microsoft.UI.Xaml.Visibility', 'Collapsed', 1]
  ]) {
    const type = bridge.typeFromName(owner), field = type.getMembers(name)[0];
    assert.equal(field.constantValue, value, 'released symbol API');
    assert.equal(field.constantValueObject.value, value);
    assert.equal(field.constantValueObject.enumType === type, true, 'declaring enum identity');
    assert.equal(field.isEnumMember, true);
  }
});

test('A15 semantic enum constants survive initializers, calls, assignments and explicit casts in every engine', () => {
  const built = compilePropertyFixture(`using System; using System.Collections.Specialized;
    using Microsoft.UI.Xaml.Controls; using Microsoft.UI.Xaml.Data;
    class EnumSource : Control {
      public BindingMode Mode { get; set; }
      public NotifyCollectionChangedAction Action { get; set; }
      public NotifyCollectionChangedEventArgs Changed() {
        return new NotifyCollectionChangedEventArgs(NotifyCollectionChangedAction.Replace, 9, 4, 0);
      }
    }
    class P { static void Main() {
      EnumSource source = new EnumSource { Mode = BindingMode.OneWay, Action = NotifyCollectionChangedAction.Replace };
      Console.WriteLine((int)source.Mode); Console.WriteLine((int)source.Action);
      Binding binding = new Binding { Mode = BindingMode.TwoWay };
      Console.WriteLine((int)binding.Mode); Console.WriteLine((int)source.Changed().Action);
      source.Mode = BindingMode.OneTime; Console.WriteLine((int)source.Mode);
    } }`);
  for (const [name, vm] of propertyEngines(built)) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', name + ': ' + JSON.stringify(result.fault));
    assert.equal(result.output, '1\n2\n2\n2\n0\n', name);
  }
});

test('A15 enum constants do not silently convert between unrelated registered enum types', () => {
  const result = compile(`using Microsoft.UI.Xaml.Data; using System.Collections.Specialized;
    BindingMode mode = NotifyCollectionChangedAction.Replace;`);
  assert.equal(result.success, false);
  assert(result.diagnostics.some(item => item.code === 'CS0029' || item.code === 'CS0266'));
});
