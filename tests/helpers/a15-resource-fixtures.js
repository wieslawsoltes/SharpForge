import {DependencyPropertyRegistry, PropertyStore, ResourceScope, XamlSchema, registerXamlResourceTypes} from '@sharpforge/winui-properties';

export function propertyFixture() {
  const baseType = type => type === 'Button' || type === 'Text' ? 'Element' : null;
  const registry = new DependencyPropertyRegistry({baseType});
  const width = registry.register({ownerType: 'Element', name: 'Width', propertyType: 'double', metadata: {defaultValue: 0}});
  const text = registry.register({ownerType: 'Element', name: 'Text', propertyType: 'string', metadata: {defaultValue: ''}});
  const stores = new Map();
  const create = (type = 'Button', name = '') => {
    const target = {type, name, children: [], disposed: false};
    stores.set(target, new PropertyStore({registry, ownerType: type, owner: target}));
    return target;
  };
  const storeFor = target => stores.get(target);
  const adapter = {
    children: target => target.children,
    typeOf: target => target.type,
    name: target => target.name,
    storeFor,
    setTemplatedParent: (target, owner) => { target.templatedParent = owner; },
    attachRoot: (owner, root) => { owner.templateRoot = root; },
    detach: target => { target.detached = true; },
    dispose: target => { target.disposed = true; },
    setDataContext: (target, data) => { target.data = data; }
  };
  return {registry, width, text, stores, storeFor, create, adapter, resources: new ResourceScope()};
}

export function xamlFixture() {
  const schema = registerXamlResourceTypes(new XamlSchema());
  const prefix = 'Microsoft.UI.Xaml.Controls.';
  let created = 0;
  const property = (name, type, collection = false) => ({name, type, collection,
    set: (target, value) => { target[name] = value; }, get: target => target[name],
    add: collection ? (target, value) => { (target[name] ??= []).push(value); } : null});
  for (const name of ['Grid', 'StackPanel', 'Button', 'TextBlock']) {
    schema.register({name: prefix + name, kind: 'control',
      create: () => { created++; return {valueType: prefix + name, Children: []}; },
      contentProperty: name === 'Button' ? 'Content' : name === 'TextBlock' ? 'Text' : 'Children',
      properties: {
        Name: property('Name', 'string'), Width: property('Width', 'double'), Margin: property('Margin', 'Microsoft.UI.Xaml.Thickness'),
        Background: property('Background', 'object'), Content: property('Content', 'object'), Text: property('Text', 'string'),
        Tag: property('Tag', 'object'), Resources: property('Resources', 'Microsoft.UI.Xaml.ResourceDictionary'),
        Children: property('Children', 'object[]', true)
      }});
  }
  schema.register({name: 'Microsoft.UI.Xaml.Media.SolidColorBrush', create: () => ({valueType: 'Microsoft.UI.Xaml.Media.SolidColorBrush'}),
    properties: {Color: property('Color', 'Windows.UI.Color'), Opacity: property('Opacity', 'double')}});
  return {schema, created: () => created};
}
