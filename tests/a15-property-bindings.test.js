import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DependencyPropertyRegistry, PropertyStore, Binding, BindingOperations, BindingMode, UpdateSourceTrigger,
  ObservableObject, ObservableVector, UnsetValue, parsePropertyPath
} from '@sharpforge/winui-properties';

function target(type = 'string') {
  const registry = new DependencyPropertyRegistry();
  const property = registry.register({ownerType: 'Element', name: 'Text', propertyType: type});
  return {property, store: new PropertyStore({registry, ownerType: 'Element'})};
}

test('A15 paths parse nested indexes, dictionary keys and attached properties once', () => {
  assert.deepEqual(parsePropertyPath('Order.Lines[2].Product.Name').map(step => step.kind), ['property', 'property', 'index', 'property', 'property']);
  assert.equal(parsePropertyPath("Items['a.b']")[1].key, 'a.b');
  assert.equal(parsePropertyPath('(Grid.Row)')[0].owner, 'Grid');
  for (const path of ['Order.', 'Items[', 'A..B', 'Items[]', '(Grid)', 'A B']) assert.throws(() => parsePropertyPath(path));
});

test('A15 OneWay replaces intermediate subscriptions and restores them after unload', () => {
  const first = new ObservableObject({Name: 'first'});
  const second = new ObservableObject({Name: 'second'});
  const source = new ObservableObject({Child: first});
  const {store, property} = target();
  const bindings = new BindingOperations();
  bindings.SetBinding(store, property, new Binding({Source: source, Path: 'Child.Name'}));
  assert.equal(store.getValue(property), 'first');
  source.set('Child', second);
  assert.equal(store.getValue(property), 'second');
  assert.equal(first.subscriberCount, 0);
  second.set('Name', 'updated');
  assert.equal(store.getValue(property), 'updated');
  bindings.unloaded(store);
  assert.equal(source.subscriberCount + second.subscriberCount, 0);
  second.set('Name', 'after unload');
  bindings.loaded(store);
  assert.equal(store.getValue(property), 'after unload');
  bindings.ClearAllBindings(store);
  assert.equal(source.subscriberCount + second.subscriberCount, 0);
});

test('A15 TwoWay honors PropertyChanged, LostFocus and explicit UpdateSource', () => {
  for (const trigger of ['PropertyChanged', 'LostFocus', 'Explicit']) {
    const source = new ObservableObject({Name: 'before'});
    const {store, property} = target();
    const bindings = new BindingOperations();
    const expression = bindings.SetBinding(store, property, new Binding({
      Source: source, Path: 'Name', Mode: BindingMode.TwoWay, UpdateSourceTrigger: UpdateSourceTrigger[trigger]
    }));
    expression.notifyTargetChanged('after');
    assert.equal(source.get('Name'), trigger === 'PropertyChanged' ? 'after' : 'before');
    if (trigger === 'LostFocus') expression.LostFocus();
    if (trigger === 'Explicit') expression.UpdateSource();
    assert.equal(source.get('Name'), 'after');
    source.set('Name', 'again');
    assert.equal(store.getValue(property), 'again');
    expression.dispose();
  }
});

test('A15 indexed ObservableVector paths update incrementally', () => {
  const vector = new ObservableVector([new ObservableObject({Name: 'zero'}), new ObservableObject({Name: 'one'})]);
  const source = new ObservableObject({Items: vector});
  const {store, property} = target();
  const operations = new BindingOperations();
  operations.SetBinding(store, property, new Binding({Source: source, Path: 'Items[1].Name'}));
  assert.equal(store.getValue(property), 'one');
  vector.Insert(0, new ObservableObject({Name: 'new'}));
  assert.equal(store.getValue(property), 'zero');
  vector.RemoveAt(0);
  assert.equal(store.getValue(property), 'one');
  operations.ClearAllBindings(store);
  assert.equal(vector.subscriberCount, 0);
});

test('A15 null, missing values and converter failures take distinct fallback paths', () => {
  const {store, property} = target();
  const source = new ObservableObject({Name: null});
  const diagnostics = [];
  const bindings = new BindingOperations({diagnostics: diagnostic => diagnostics.push(diagnostic)});
  bindings.SetBinding(store, property, new Binding({Source: source, Path: 'Name', TargetNullValue: 'null', FallbackValue: 'missing'}));
  assert.equal(store.getValue(property), 'null');
  bindings.SetBinding(store, property, new Binding({Source: source, Path: 'Unknown', FallbackValue: 'missing'}));
  assert.equal(store.getValue(property), 'missing');
  bindings.SetBinding(store, property, new Binding({Source: source, Path: 'Name', FallbackValue: 'failed', Converter: {
    Convert() { return UnsetValue; }
  }}));
  assert.equal(store.getValue(property), 'failed');
  bindings.SetBinding(store, property, new Binding({Source: source, Path: 'Bad[', FallbackValue: 'syntax'}));
  assert.equal(store.getValue(property), 'syntax');
  assert(diagnostics.some(diagnostic => diagnostic.code === 'SFB001'));
  assert(diagnostics.every(diagnostic => diagnostic.valuesRedacted));
});

test('A15 OneTime never subscribes to the path and explicit UpdateTarget can refresh', () => {
  const source = new ObservableObject({Name: 'one'});
  const {store, property} = target();
  const expression = new BindingOperations().SetBinding(store, property, new Binding({
    Source: source, Path: 'Name', Mode: BindingMode.OneTime
  }));
  assert.equal(source.subscriberCount, 0);
  source.set('Name', 'two');
  assert.equal(store.getValue(property), 'one');
  expression.UpdateTarget();
  assert.equal(store.getValue(property), 'two');
});
