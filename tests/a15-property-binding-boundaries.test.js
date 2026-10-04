import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DependencyPropertyRegistry, PropertyStore, Binding, BindingOperations, ObservableObject, UnsetValue,
  RelativeSource, RelativeSourceMode, createTemplateBinding, ValueSource, convertBindingValue
} from '@sharpforge/winui-properties';
import {frameworkType, frameworkAssignable} from '@sharpforge/framework';

function fixture(type = 'string', services = {}) {
  const diagnostics = [];
  const registry = new DependencyPropertyRegistry({typeDefinition: frameworkType, isAssignable: frameworkAssignable});
  const property = registry.register({ownerType: 'Owner', name: type === 'double' ? 'Width' : 'Text', propertyType: type});
  const owner = {};
  const store = new PropertyStore({registry, owner, ownerType: 'Owner'});
  const operations = new BindingOperations({typeDefinition: frameworkType, diagnostics: value => diagnostics.push(value), ...services});
  return {registry, owner, property, store, operations, diagnostics};
}

test('A15 all binding failure families are structured, bounded and value-redacted', () => {
  const observed = new Set();
  const failures = [
    [{Path: 'Bad['}, {}, 'SFB001'], [{}, {}, 'SFB002'],
    [{Source: {}, Path: 'Missing'}, {}, 'SFB003'], [{Source: {Items: []}, Path: 'Items[2]'}, {}, 'SFB004'],
    [{Source: {Value: 'secret-value'}, Path: 'Value', Converter: {Convert() { throw new Error('secret-value'); }}}, {}, 'SFB005'],
    [{Source: {Value: 'bad-number'}, Path: 'Value'}, {type: 'double'}, 'SFB006'],
    [{Source: Object.freeze({Value: 'before'}), Path: 'Value', Mode: 'TwoWay'}, {writeBack: true}, 'SFB007'],
    [{Source: {Value: 'value'}, Path: 'Value'}, {services: {subscribe() { throw new Error('secret-value'); }}, detach: true}, 'SFB003']
  ];
  for (const [options, setup, expected] of failures) {
    const target = fixture(setup.type, setup.services);
    const expression = target.operations.SetBinding(target.store, target.property, new Binding(options));
    if (setup.writeBack) expression.notifyTargetChanged('after');
    if (setup.detach) expression.detach();
    assert(target.diagnostics.some(value => value.code === expected), expected);
    for (const diagnostic of target.diagnostics) {
      observed.add(diagnostic.code);
      assert.equal(diagnostic.valuesRedacted, true);
      assert.equal(JSON.stringify(diagnostic).includes('secret-value'), false);
    }
    expression.dispose();
  }
  const invalid = fixture();
  assert.throws(() => invalid.operations.SetBinding(invalid.store, {...invalid.property}, new Binding()), {kind: 'ArgumentException'});
  observed.add(invalid.diagnostics.at(-1).code);
  const lifetime = fixture('string', {subscribe: () => () => { throw new Error('private-source-state'); }});
  const expression = lifetime.operations.SetBinding(lifetime.store, lifetime.property, new Binding({Source: {Value: 'value'}, Path: 'Value'}));
  expression.detach();
  observed.add(lifetime.diagnostics.at(-1).code);
  const changing = new ObservableObject({Value: 'value'});
  let count = 0;
  const cycle = fixture('string', {maxUpdates: 3});
  cycle.operations.SetBinding(cycle.store, cycle.property, new Binding({Source: changing, Path: 'Value', Converter: {
    Convert() { changing.set('Value', String(++count)); return 'value'; }
  }}));
  assert(cycle.diagnostics.some(value => value.code === 'SFB008'));
  observed.add('SFB008');
  assert.deepEqual([...observed].sort(), Array.from({length: 10}, (_, index) => 'SFB' + String(index + 1).padStart(3, '0')));
});

test('A15 DataContext replacement, namescopes and relative sources rebuild the same path observers', () => {
  const target = fixture();
  const contextProperty = target.registry.register({ownerType: 'Owner', name: 'DataContext'});
  const first = new ObservableObject({Name: 'first'}), second = new ObservableObject({Name: 'second'});
  target.store.setValue(contextProperty, first);
  target.operations.SetBinding(target.store, target.property, new Binding({Path: 'Name'}));
  target.store.setValue(contextProperty, second);
  assert.equal(target.store.getValue(target.property), 'second');
  assert.equal(first.subscriberCount, 0);
  let named = first, changed;
  const namedOperations = new BindingOperations({findName: () => named, subscribeNameScope: (owner, callback) => { changed = callback; return () => {}; }});
  target.operations.ClearAllBindings(target.store);
  namedOperations.SetBinding(target.store, target.property, new Binding({ElementName: 'named', Path: 'Name'}));
  assert.equal(target.store.getValue(target.property), 'first');
  named = second;
  changed();
  assert.equal(target.store.getValue(target.property), 'second');
  namedOperations.ClearAllBindings(target.store);
  target.owner.Name = 'self';
  target.operations.SetBinding(target.store, target.property, new Binding({RelativeSource: new RelativeSource(RelativeSourceMode.Self), Path: 'Name'}));
  assert.equal(target.store.getValue(target.property), 'self');
  target.operations.ClearAllBindings(target.store);
});

test('A15 TemplateBinding reads owner defaults and source changes below an explicit local value', () => {
  const target = fixture();
  const parent = fixture();
  parent.store.setValue(parent.property, 'parent');
  const expression = createTemplateBinding({store: target.store, property: target.property,
    sourceProperty: parent.property, owner: parent.owner, ownerStore: parent.store});
  assert.equal(target.store.getValue(target.property), 'parent');
  target.store.setValue(target.property, 'local');
  parent.store.setValue(parent.property, 'updated');
  assert.equal(target.store.getValue(target.property), 'local');
  target.store.clearValue(target.property);
  assert.equal(target.store.getValue(target.property), 'updated');
  assert.equal(target.store.getValueSource(target.property), ValueSource.TemplatedParent);
  expression.dispose();
});

test('A15 literal bindings materialize Width, Margin and Foreground with invalid-value fallback', () => {
  const width = fixture('double');
  const source = new ObservableObject({Value: '42'});
  width.operations.SetBinding(width.store, width.property, new Binding({Source: source, Path: 'Value', FallbackValue: '12'}));
  assert.equal(width.store.getValue(width.property), 42);
  source.set('Value', 'not a number');
  assert.equal(width.store.getValue(width.property), 12);
  const margin = convertBindingValue('1,2,3,4', 'Microsoft.UI.Xaml.Thickness', {typeDefinition: frameworkType});
  assert.deepEqual(margin, {valueType: 'Microsoft.UI.Xaml.Thickness', Left: 1, Top: 2, Right: 3, Bottom: 4});
  const brush = convertBindingValue('#7F123456', 'Microsoft.UI.Xaml.Media.Brush', {typeDefinition: frameworkType});
  assert.equal(brush.valueType, 'Microsoft.UI.Xaml.Media.SolidColorBrush');
  assert.deepEqual(brush.Color, {valueType: 'Windows.UI.Color', A: 127, R: 18, G: 52, B: 86});
  assert.throws(() => convertBindingValue('1,2,three,4', 'Microsoft.UI.Xaml.Thickness', {typeDefinition: frameworkType}));
  assert.equal(convertBindingValue(UnsetValue, 'double'), UnsetValue);
});

test('A15 queued TwoWay target notifications do not feed converter outputs back into the source', () => {
  const target = fixture('double');
  const source = new ObservableObject({Value: 3});
  const expression = target.operations.SetBinding(target.store, target.property, new Binding({Source: source, Path: 'Value', Mode: 'TwoWay',
    Converter: {Convert: value => value * 2, ConvertBack: value => value}}));
  target.store.transaction(() => {
    expression.notifyTargetChanged(5);
  });
  assert.equal(source.get('Value'), 5);
  assert.equal(target.store.getValue(target.property), 10);
  expression.dispose();
});
