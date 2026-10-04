import {XamlSchema} from './schema.js';
import {registerXamlResourceTypes} from './resource-builders.js';
import {PRESENTATION_NAMESPACE} from './xml-reader.js';

const contentProperties = Object.freeze({
  'Microsoft.UI.Xaml.Controls.Panel': 'Children',
  'Microsoft.UI.Xaml.Controls.ContentControl': 'Content',
  'Microsoft.UI.Xaml.Controls.Border': 'Child',
  'Microsoft.UI.Xaml.Controls.ItemsControl': 'Items',
  'Microsoft.UI.Xaml.Controls.ListView': 'Items',
  'Microsoft.UI.Xaml.Controls.ComboBox': 'Items',
  'Microsoft.UI.Xaml.Controls.TextBlock': 'Text',
  'Microsoft.UI.Xaml.Controls.TextBox': 'Text',
  'Microsoft.UI.Xaml.Controls.RowDefinition': 'Height',
  'Microsoft.UI.Xaml.Controls.ColumnDefinition': 'Width',
  'Microsoft.UI.Xaml.VisualStateGroup': 'States',
  'Microsoft.UI.Xaml.Media.Animation.Storyboard': 'Children'
});

function permitted(type) {
  if (type.name === 'Microsoft.UI.Xaml.VisualStateManager') return true;
  if (type.xamlLoadable === true) return true;
  if (!['control', 'abstract', 'object', 'brush', 'value', 'collection', 'enum', 'animation',
    'transform', 'easing', 'shape', 'rendering'].includes(type.kind)) return false;
  return type.name.startsWith('Microsoft.UI.Xaml.') || type.name.startsWith('Windows.Foundation.') ||
    type.name === 'Windows.UI.Color' || type.name.startsWith('SharpForge.UI.');
}

function isCollection(type) {
  return type?.kind === 'collection' || type?.xamlCollection === true;
}

/** Build a closed XAML allowlist from the existing ABI registry without dynamic CLR activation. */
export function createFrameworkXamlSchema({registry, create, set, get, add, insert = null, remove = null, propertyFor = null,
  parseGeometry = null, visualStateGroupsFor = null, isLoadable = permitted} = {}) {
  const schema = registerXamlResourceTypes(new XamlSchema());
  schema.parseGeometry = parseGeometry;
  const attached = new Map();
  for (const contract of registry.contracts ?? []) {
    if (contract.kind !== 'attachedSet') continue;
    let declarations = attached.get(contract.owner);
    if (!declarations) attached.set(contract.owner, declarations = []);
    declarations.push(contract);
  }
  for (const type of registry.types.values()) {
    if (schema.type(type.name) || !isLoadable(type)) continue;
    const properties = {};
    for (const [name, property] of Object.entries(type.properties ?? {})) {
      if (property.isStatic) continue;
      const collection = isCollection(registry.types.get(property.type));
      properties[name] = {name, type: property.type, readOnly: property.readOnly, collection,
        property: propertyFor?.(type.name, name),
        get: instance => get(instance, name),
        set: property.readOnly ? null : (instance, value) => set(instance, name, value, property.type),
        add: collection ? (instance, value) => add(get(instance, name), value) : null,
        insert: collection && insert ? (instance, index, value) => insert(get(instance, name), index, value) : null,
        remove: collection && remove ? (instance, index) => remove(get(instance, name), index) : null};
    }
    for (const [name, delegate] of Object.entries(type.events ?? {})) {
      const signature = registry.types.get(delegate);
      const invoke = (registry.memberIndex?.get(delegate + '::Invoke') ?? []).find(member => member.kind === 'method');
      properties[name] = {name, type: delegate, kind: 'event', event: true, readOnly: true,
        eventTypes: invoke?.parameters ?? signature?.parameters ?? ['object', 'object']};
    }
    for (const contract of attached.get(type.name) ?? []) {
      const name = contract.property;
      properties[name] = {name, type: contract.parameters.at(-1), attached: true,
        property: propertyFor?.(type.name, name, {attached: true}),
        set: (instance, value) => set(instance, name, value, contract.parameters.at(-1), {owner: type.name, attached: true}),
        get: instance => get(instance, name, {owner: type.name, attached: true})};
    }
    if (type.name === 'Microsoft.UI.Xaml.VisualStateManager' && visualStateGroupsFor) {
      properties.VisualStateGroups = {name: 'VisualStateGroups', type: 'Microsoft.UI.Xaml.VisualStateGroupCollection',
        attached: true, collection: true, readOnly: true,
        get: instance => visualStateGroupsFor(instance),
        add: (instance, value) => add(visualStateGroupsFor(instance), value)};
    }
    const namespace = type.xamlNamespace ?? (type.xamlLoadable ? 'using:' + type.name.slice(0, type.name.lastIndexOf('.')) : PRESENTATION_NAMESPACE);
    schema.register({name: type.name, namespace, kind: type.kind, base: type.base,
      values: type.values, flags: !!type.flags, properties,
      contentProperty: type.contentProperty ?? contentProperties[type.name] ?? null,
      create: type.kind === 'enum' || type.kind === 'abstract' ? null : () => create(type.name),
      add: isCollection(type) ? (instance, value) => add(instance, value) : null,
      insert: isCollection(type) && insert ? (instance, index, value) => insert(instance, index, value) : null,
      remove: isCollection(type) && remove ? (instance, index) => remove(instance, index) : null});
  }
  for (const type of schema.byName.values()) {
    const separator = type.name.lastIndexOf('.');
    if (separator < 0) continue;
    schema.registerAlias('using:' + type.name.slice(0, separator), type.name.slice(separator + 1), type);
  }
  return schema;
}
