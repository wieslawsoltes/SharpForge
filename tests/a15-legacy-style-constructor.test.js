import test from 'node:test';
import assert from 'node:assert/strict';
import {UIExtensionRegistry} from '@sharpforge/winui-properties';
import {registerStyleResourceAdapters} from '../packages/winui-properties/src/object-model/style-resource-adapters.js';

test('A15 the registered string ABI and JavaScript string constructor alone select the mutable legacy profile', () => {
  const registry = new UIExtensionRegistry();
  registerStyleResourceAdapters(registry);
  const context = {typeName: value => typeof value === 'string' ? value : value.name, wrapModel: value => value};
  const member = {owner: 'Microsoft.UI.Xaml.Style', kind: 'constructor', name: '.ctor'};
  const create = (parameters, args) => registry.invoke(context, {...member, parameters}, null, args).value;
  assert.equal(create(['string'], ['Button']).legacyMutable, true);
  assert.equal(create(['System.String'], ['Button']).legacyMutable, true);
  assert.equal(create(undefined, ['Button']).legacyMutable, true);
  assert.equal(create(['System.Type'], [{name: 'Button'}]).legacyMutable, false);
  assert.equal(create(undefined, [{name: 'Button'}]).legacyMutable, false);
  assert.equal(create([], []).legacyMutable, false);
});
