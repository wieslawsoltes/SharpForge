import {ValueSource} from '@sharpforge/winui-properties';
import {XAML} from '@sharpforge/framework';
import {managedTypeName} from './property-values.js';
import {clearProperty} from '../styling.js';

function registerProperty({context, args, descriptor}) {
  const services = context.properties;
  const propertyType = managedTypeName(context.platform, args[1]);
  const metadata = args[3];
  const read = name => metadata ? context.read(metadata, name) : null;
  const definition = services.registry.register({
    name: context.native(args[0]), propertyType,
    ownerType: managedTypeName(context.platform, args[2]),
    attached: descriptor.name === 'RegisterAttached',
    metadata: {
      defaultValue: metadata ? services.toNative(read('DefaultValue'), propertyType) : undefined,
      propertyChangedCallback: read('PropertyChangedCallback'),
      createDefaultValueCallback: read('CreateDefaultValueCallback'),
      validateValueCallback: read('ValidateValueCallback'),
      coerceValueCallback: read('CoerceValueCallback'),
      inherits: !!context.native(read('Inherits'))
    }
  });
  return services.wrap(definition);
}

/** Register dependency-object operations once for both source and direct CIL dispatch. */
export function registerManagedPropertyAdapters(registry) {
  for (const name of ['Register', 'RegisterAttached']) {
    registry.register({owner: XAML + 'DependencyProperty', name, arity: 4}, registerProperty);
  }
  registry.register({owner: XAML + 'PropertyMetadata', kind: 'constructor', name: '.ctor'}, ({context, args}) => {
    return context.allocate(XAML + 'PropertyMetadata', {DefaultValue: args[0] ?? null, PropertyChangedCallback: args[1] ?? null});
  });
  registry.register({owner: XAML + 'PropertyMetadata', name: 'Create'}, ({context, args}) => {
    return context.allocate(XAML + 'PropertyMetadata', {DefaultValue: null,
      CreateDefaultValueCallback: args[0], PropertyChangedCallback: args[1] ?? null});
  });
  registry.register({owner: XAML + 'DependencyProperty', name: 'GetMetadata'}, ({context, receiver, args}) => {
    const property = context.properties.resolve(receiver);
    if (!context.propertyRegistry.applicable(property, context.typeName(args[0]))) {
      throw new TypeError('Metadata owner is incompatible with the dependency property');
    }
    return context.state(receiver, 'metadataReference', () => {
      const metadata = property.metadata;
      return context.allocate(XAML + 'PropertyMetadata', {
        DefaultValue: context.properties.toManaged(metadata.defaultValue, property.propertyType, {box: true}),
        PropertyChangedCallback: metadata.propertyChangedCallback,
        CreateDefaultValueCallback: metadata.createDefaultValueCallback
      });
    });
  });
  const read = ({context, receiver, args, descriptor}) => context.properties.read(receiver,
    context.properties.resolve(args[0]), {local: descriptor.name === 'ReadLocalValue', box: true});
  for (const name of ['GetValue', 'ReadLocalValue']) {
    registry.register({owner: XAML + 'DependencyObject', name, arity: 1}, read);
  }
  registry.register({owner: XAML + 'DependencyObject', name: 'SetValue', arity: 2}, ({context, receiver, args}) => {
    const property = context.properties.resolve(args[0]);
    return context.platform.setProperty(receiver, {owner: property.ownerType, property: property.name, dependencyProperty: property}, args[1]);
  });
  registry.register({owner: XAML + 'DependencyObject', name: 'ClearValue', arity: 1}, ({context, receiver, args}) => {
    const property = context.properties.resolve(args[0]);
    clearProperty(context.platform, receiver, property);
    return null;
  });
  registry.register({owner: XAML + 'DependencyObject', name: 'RegisterPropertyChangedCallback', arity: 2},
    ({context, receiver, args}) => {
      const property = context.properties.resolve(args[0]);
      const token = context.storeFor(receiver).registerPropertyChangedCallback(property, args[1]);
      context.properties.syncRoots(receiver);
      return BigInt(token);
    });
  registry.register({owner: XAML + 'DependencyObject', name: 'UnregisterPropertyChangedCallback', arity: 2},
    ({context, receiver, args}) => {
      context.storeFor(receiver).unregisterPropertyChangedCallback(context.properties.resolve(args[0]), Number(context.native(args[1])));
      context.properties.syncRoots(receiver);
      return null;
    });
}
