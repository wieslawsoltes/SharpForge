import test from 'node:test';
import assert from 'node:assert/strict';
import {Binding, BindingOperations, DependencyPropertyRegistry, PropertyStore} from '@sharpforge/winui-properties';

test('A15 malformed BindingExpression rewind preserves diagnostics without replaying callbacks', () => {
  const registry = new DependencyPropertyRegistry();
  const property = registry.register({ownerType: 'Target', name: 'Text', propertyType: 'string'});
  const store = new PropertyStore({registry, ownerType: 'Target'});
  const diagnostics = [];
  const operations = new BindingOperations({diagnostics: value => diagnostics.push(value)});
  const expression = operations.SetBinding(store, property, new Binding({Source: {}, Path: 'Broken[', FallbackValue: 'fallback'}));
  const snapshot = expression.snapshot(), count = diagnostics.length;
  expression.dispose();
  expression.restore(snapshot);
  assert.equal(diagnostics.length, count);
  assert.equal(expression.error.code, 'SFB001');
  expression.dispose();
});

