import test from 'node:test';
import assert from 'node:assert/strict';
import {DependencyPropertyRegistry, PropertyStore, propertyValuesEqual, registerBuiltInAttachedProperties} from '@sharpforge/winui-properties';

test('A15 only the injected host capability may update a read-only dependency property', () => {
  const registry = new DependencyPropertyRegistry();
  const width = registry.register({ownerType: 'Element', name: 'ActualWidth', propertyType: 'double', readOnly: true});
  const key = Object.freeze({});
  const changes = [];
  const store = new PropertyStore({registry, ownerType: 'Element', readOnlyKey: key, onChange: change => changes.push(change)});
  assert.throws(() => store.setValue(width, 12), {kind: 'InvalidOperationException'});
  assert.throws(() => store.setReadOnlyValue(width, 12, {}), {kind: 'InvalidOperationException'});
  store.setReadOnlyValue(width, 12, key);
  assert.equal(store.getValue(width), 12);
  assert.equal(changes.length, 1);
  store.setReadOnlyValue(width, 12, key);
  assert.equal(changes.length, 1);
});

test('A15 struct values compare by fields while brushes keep reference identity', () => {
  const left = {valueType: 'Microsoft.UI.Xaml.Thickness', Left: 3, Top: 3, Right: 3, Bottom: 3};
  assert.equal(propertyValuesEqual(left, {...left}), true);
  assert.equal(propertyValuesEqual(left, {...left, Bottom: 4}), false);
  const brush = {valueType: 'Microsoft.UI.Xaml.Media.SolidColorBrush', Color: '#ffffff'};
  assert.equal(propertyValuesEqual(brush, {...brush}), false);
  assert.equal(propertyValuesEqual({h: 7, g: 3}, {h: 7, g: 3}), true);
  assert.equal(propertyValuesEqual({h: 7, g: 3}, {h: 7, g: 4}), false);
  assert.equal(propertyValuesEqual(-0, 0), true);
  assert.equal(propertyValuesEqual(NaN, NaN), true);
});

test('A15 distinct released font identities share only explicitly keyed inheritance', () => {
  const registry = new DependencyPropertyRegistry();
  const metadata = {defaultValue: 12, inherits: true, inheritanceKey: 'FontSize'};
  const controlFont = registry.register({ownerType: 'Control', name: 'FontSize', propertyType: 'double', metadata});
  const textFont = registry.register({ownerType: 'Text', name: 'FontSize', propertyType: 'double', metadata});
  const control = new PropertyStore({registry, ownerType: 'Control'});
  const text = new PropertyStore({registry, ownerType: 'Text'});
  text.setParent(control);
  assert.notEqual(controlFont, textFont);
  assert.equal(text.getValue(textFont), 12);
  control.setValue(controlFont, 30);
  assert.equal(text.getValue(textFont), 30);
  text.setValue(textFont, 42);
  control.setValue(controlFont, 24);
  assert.equal(text.getValue(textFont), 42);
  text.clearValue(textFont);
  assert.equal(text.getValue(textFont), 24);
});

test('A15 attached profiles merge late instance metadata before lazy lookup and use typed defaults', () => {
  const registry = new DependencyPropertyRegistry({getDeclaredProperty: (type, name) => type === 'Text' && name === 'FontSize'
    ? {type: 'double', value: 14} : null});
  const table = registerBuiltInAttachedProperties(registry, [
    {id: 1, owner: 'Text', kind: 'attachedSet', name: 'SetFontSize', parameters: ['object', 'double'],
      metadata: {defaultValue: 14, inherits: true, inheritanceKey: 'FontSize'}},
    {id: 2, owner: 'Typography', kind: 'attachedSet', name: 'SetEnabled', parameters: ['object', 'bool']}
  ]);
  const font = registry.lookup('Text', 'FontSize');
  assert.equal(font.attached, true);
  assert.equal(font.metadata.inherits, true);
  assert.equal(font, table.byContract.get(1));
  const owner = new PropertyStore({registry, ownerType: 'AnyOwner'});
  const child = new PropertyStore({registry, ownerType: 'OtherOwner'});
  child.setParent(owner);
  owner.setValue(font, 20);
  assert.equal(child.getValue(font), 20);
  assert.equal(owner.getValue(table.byContract.get(2)), false);
});
