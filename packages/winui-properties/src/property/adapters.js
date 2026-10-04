import {PropertyMetadata} from './metadata.js';
import {UnsetValue} from './values.js';
import {registerBindingAdapters} from '../binding/adapters.js';
import {registerObservableAdapters} from '../observable/adapters.js';

const XAML = 'Microsoft.UI.Xaml.';
const lowerFirst = name => name[0].toLowerCase() + name.slice(1);

function token(context, value) {
  return context.properties?.resolve(value) ?? context.propertyRegistry.resolve(context.unwrapModel?.(value) ?? value);
}

function register(context, args, attached) {
  const definition = context.propertyRegistry.register({
    name: context.native(args[0]), propertyType: context.typeName(args[1]), ownerType: context.typeName(args[2]),
    metadata: args[3] ? context.unwrapModel(args[3]) : undefined, attached
  });
  return context.wrapModel(definition, XAML + 'DependencyProperty');
}

/** Install portable property, binding and observable contributions into one application registry. */
export function registerPropertyAdapters(registry, {dependencyProperties = true} = {}) {
  if (dependencyProperties) registerDependencyPropertyAdapters(registry);
  registerBindingAdapters(registry);
  registerObservableAdapters(registry);
}

function registerDependencyPropertyAdapters(registry) {
  for (const name of ['Register', 'RegisterAttached']) {
    registry.register({owner: XAML + 'DependencyProperty', name, arity: 4},
      ({context, args}) => register(context, args, name === 'RegisterAttached'));
  }
  registry.register({owner: XAML + 'PropertyMetadata', kind: 'constructor', name: '.ctor'}, ({context, args}) => {
    return context.wrapModel(new PropertyMetadata(context.native(args[0]), args[1] ?? null), XAML + 'PropertyMetadata');
  });
  registry.register({owner: XAML + 'PropertyMetadata', name: 'Create'}, ({context, args}) => {
    return context.wrapModel(new PropertyMetadata(null, args[1] ?? null, {createDefaultValueCallback: args[0]}), XAML + 'PropertyMetadata');
  });
  for (const name of ['DefaultValue', 'PropertyChangedCallback', 'CreateDefaultValueCallback']) {
    registry.register({owner: XAML + 'PropertyMetadata', kind: 'get', name: 'get_' + name}, ({context, receiver, descriptor}) => {
      return context.managed(context.unwrapModel(receiver)[lowerFirst(name)], descriptor.result);
    });
  }
  registry.register({owner: XAML + 'DependencyProperty', name: 'GetMetadata'}, ({context, receiver, args}) => {
    const property = token(context, receiver);
    const owner = context.typeName(args[0]);
    if (!context.propertyRegistry.applicable(property, owner)) throw new TypeError('Metadata owner is incompatible with the property');
    return context.wrapModel(property.metadata, XAML + 'PropertyMetadata');
  });
  registry.register({owner: XAML + 'DependencyProperty', kind: 'get', name: 'get_Name'}, ({context, receiver}) => {
    return context.managed(token(context, receiver).name, 'string');
  });
  for (const name of ['GetValue', 'ReadLocalValue']) {
    registry.register({owner: XAML + 'DependencyObject', name}, ({context, receiver, args}) => {
      const store = context.storeFor(receiver);
      const property = token(context, args[0]);
      const value = name === 'ReadLocalValue' ? store.readLocalValue(property) : store.getValue(property);
      if (value !== UnsetValue && context.properties?.toManaged) {
        return context.properties.toManaged(value, property.propertyType, {box: true});
      }
      return context.managed(value, value === UnsetValue ? 'object' : property.propertyType);
    });
  }
  registry.register({owner: XAML + 'DependencyObject', name: 'SetValue'}, ({context, receiver, args}) => {
    const property = token(context, args[0]);
    if (context.styles) context.styles.set(receiver, property, context.native(args[1]));
    else context.storeFor(receiver).setValue(property, context.native(args[1]));
  });
  registry.register({owner: XAML + 'DependencyObject', name: 'ClearValue'}, ({context, receiver, args}) => {
    const property = token(context, args[0]);
    if (context.styles) context.styles.clear(receiver, property);
    else context.storeFor(receiver).clearValue(property);
  });
  registry.register({owner: XAML + 'DependencyObject', name: 'RegisterPropertyChangedCallback'}, ({context, receiver, args}) => {
    return context.managed(BigInt(context.storeFor(receiver).registerPropertyChangedCallback(token(context, args[0]), args[1])), 'long');
  });
  registry.register({owner: XAML + 'DependencyObject', name: 'UnregisterPropertyChangedCallback'}, ({context, receiver, args}) => {
    context.storeFor(receiver).unregisterPropertyChangedCallback(token(context, args[0]), Number(context.native(args[1])));
  });
}
