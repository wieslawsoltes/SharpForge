import {
  DependencyPropertyRegistry, PropertyStore, Binding, BindingOperations, ObservableObject, ValueSource, UnsetValue
} from '@sharpforge/winui-properties';

const registry = new DependencyPropertyRegistry({baseType: type => type === 'TextInput' ? 'Element' : null});
const text = registry.register({ownerType: 'Element', name: 'Text', propertyType: 'string', metadata: {defaultValue: ''}});
const fontSize = registry.register({ownerType: 'Element', name: 'FontSize', propertyType: 'double',
  metadata: {defaultValue: 14, inherits: true}});
const changes = [];
const parent = new PropertyStore({registry, ownerType: 'Element'});
const target = new PropertyStore({registry, ownerType: 'TextInput', owner: {name: 'editor'},
  onChange: change => changes.push({property: change.property.name, value: change.newValue})});
target.setParent(parent);
parent.setValue(fontSize, 18);

const source = new ObservableObject({Title: 'First title'});
const bindings = new BindingOperations();
const expression = bindings.SetBinding(target, text, new Binding({Source: source, Path: 'Title', Mode: 'TwoWay'}));
console.log('Initial text:', target.getValue(text));
source.set('Title', 'Changed from source');
console.log('OneWay transfer:', target.getValue(text));
expression.notifyTargetChanged('Changed from input');
console.log('TwoWay source:', source.get('Title'));

target.setSource(text, ValueSource.Animation, 'Animated text');
source.set('Title', 'New base while animating');
console.log('Animation/base:', target.getValue(text), target.getBaseValue(text));
target.clearSource(text, ValueSource.Animation);
console.log('After animation:', target.getValue(text));
console.log('Inherited font:', target.getValue(fontSize));
console.log('Local value is absent:', target.readLocalValue(text) === UnsetValue);
console.log('Effective changes:', changes);

bindings.ClearAllBindings(target);
target.dispose();
parent.dispose();
source.dispose();
