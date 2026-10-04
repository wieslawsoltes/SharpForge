import test from 'node:test';
import assert from 'node:assert/strict';
import { propertiesFor, findContracts } from '@sharpforge/framework';
import { compilePropertyFixture, propertyEngines } from './helpers/a15-property-managed-fixture.js';

test('FocusState has the pinned UIElement readonly enum property shape', () => {
  const owner = 'Microsoft.UI.Xaml.UIElement';
  const property = propertiesFor(owner).FocusState;
  assert.equal(property.type, 'Microsoft.UI.Xaml.FocusState');
  assert.equal(property.readOnly, true);
  assert.equal(property.value, 0);
  assert.equal(findContracts(owner, 'set_FocusState', false).length, 0);
});

test('the typed FocusState getter defaults to Unfocused on every managed engine', () => {
  const built = compilePropertyFixture(`using System; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
    Button button = new Button();
    Console.WriteLine(button.FocusState == FocusState.Unfocused);`);
  for (const [engine, vm] of propertyEngines(built)) {
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', engine + ': ' + result.fault?.message);
      assert.equal(result.output, 'True\n', engine);
    } finally { vm.stop(); }
  }
});
