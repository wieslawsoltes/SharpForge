import {Binding, RelativeSource, normalizeBindingMode, normalizeUpdateSourceTrigger, RelativeSourceMode} from './binding.js';
import {PropertyPath} from './property-path.js';
import {BindingExpression} from './binding-expression.js';
import {bindingsFor} from './adapter-state.js';

const XAML = 'Microsoft.UI.Xaml.';
const DATA = XAML + 'Data.';
const bindingProperties = Object.freeze([
  'Path', 'Source', 'ElementName', 'RelativeSource', 'Mode', 'Converter', 'ConverterParameter',
  'ConverterLanguage', 'FallbackValue', 'TargetNullValue', 'UpdateSourceTrigger'
]);

function native(context, receiver, Type) {
  const value = context.unwrapModel(receiver);
  if (!(value instanceof Type)) throw new TypeError('The framework wrapper has an incompatible binding model');
  return value;
}

function propertyToken(context, value) {
  return context.properties?.resolve(value) ?? context.propertyRegistry.resolve(context.unwrapModel(value));
}

function getBindingProperty({context, receiver, descriptor}) {
  const property = descriptor.property ?? descriptor.name.slice(4);
  const value = native(context, receiver, Binding)[property];
  if (property === 'Path' && value instanceof PropertyPath) return context.wrapModel(value, XAML + 'PropertyPath');
  if (property === 'RelativeSource' && value) return context.wrapModel(value, DATA + 'RelativeSource');
  return context.managed(value, descriptor.result);
}

function setBindingProperty({context, receiver, descriptor, args}) {
  const model = native(context, receiver, Binding);
  const property = descriptor.property ?? descriptor.name.slice(4);
  let value = context.properties.toNative(args[0], descriptor.parameters?.[0] ?? 'object');
  if (property === 'Path' || property === 'RelativeSource') value = context.unwrapModel(args[0]);
  if (property === 'Mode') normalizeBindingMode(value);
  if (property === 'UpdateSourceTrigger') normalizeUpdateSourceTrigger(value);
  if (property === 'Path' && value !== null && typeof value !== 'string' && !(value instanceof PropertyPath)) {
    throw new TypeError('Binding.Path requires a PropertyPath');
  }
  if (property === 'RelativeSource' && value !== null && !(value instanceof RelativeSource)) {
    throw new TypeError('Binding.RelativeSource requires a RelativeSource');
  }
  model[property] = property === 'Path' && value === null ? '' : value;
}

function setBinding({context, receiver, descriptor, args}) {
  const staticCall = descriptor.owner === DATA + 'BindingOperations';
  const owner = staticCall ? args[0] : receiver;
  const offset = staticCall ? 1 : 0;
  const binding = native(context, args[offset + 1], Binding);
  const target = bindingsFor(context, owner);
  target.operations.SetBinding(target.store, propertyToken(context, args[offset]), binding);
}

/** Standard WinUI methods call the shared BindingExpression and per-owner lifetime models. */
export function registerBindingAdapters(registry) {
  registry.register({owner: DATA + 'Binding', kind: 'constructor', name: '.ctor'}, ({context}) => {
    return context.wrapModel(new Binding(), DATA + 'Binding');
  });
  registry.register({owner: XAML + 'PropertyPath', kind: 'constructor', name: '.ctor'}, ({context, args}) => {
    return context.wrapModel(new PropertyPath(context.native(args[0])), XAML + 'PropertyPath');
  });
  registry.register({owner: XAML + 'PropertyPath', kind: 'get', name: 'get_Path'}, ({context, receiver}) => {
    return context.managed(native(context, receiver, PropertyPath).Path, 'string');
  });
  registry.register({owner: DATA + 'RelativeSource', kind: 'constructor', name: '.ctor'}, ({context}) => {
    return context.wrapModel(new RelativeSource(), DATA + 'RelativeSource');
  });
  registry.register({owner: DATA + 'RelativeSource', kind: 'get', name: 'get_Mode'}, ({context, receiver, descriptor}) => {
    return context.managed(native(context, receiver, RelativeSource).Mode, descriptor.result);
  });
  registry.register({owner: DATA + 'RelativeSource', kind: 'set', name: 'set_Mode'}, ({context, receiver, args}) => {
    const mode = context.native(args[0]);
    if (!Object.values(RelativeSourceMode).includes(mode)) throw new TypeError('Invalid RelativeSource mode');
    native(context, receiver, RelativeSource).Mode = mode;
  });
  for (const name of bindingProperties) {
    registry.register({owner: DATA + 'Binding', kind: 'get', name: 'get_' + name}, getBindingProperty);
    registry.register({owner: DATA + 'Binding', kind: 'set', name: 'set_' + name}, setBindingProperty);
  }
  registry.register({owner: DATA + 'BindingOperations', name: 'SetBinding'}, setBinding);
  registry.register({owner: XAML + 'FrameworkElement', name: 'SetBinding'}, setBinding);
  registry.register({owner: XAML + 'FrameworkElement', name: 'GetBindingExpression'}, ({context, receiver, args}) => {
    const target = bindingsFor(context, receiver);
    const expression = target.operations.GetBindingExpression(target.store, propertyToken(context, args[0]));
    return expression ? context.wrapModel(expression, DATA + 'BindingExpression') : null;
  });
  registry.register({owner: DATA + 'BindingExpression', kind: 'get', name: 'get_ParentBinding'}, ({context, receiver}) => {
    return context.wrapModel(native(context, receiver, BindingExpression).ParentBinding, DATA + 'Binding');
  });
  registry.register({owner: DATA + 'BindingExpression', kind: 'get', name: 'get_DataItem'}, ({context, receiver}) => {
    return context.managed(native(context, receiver, BindingExpression).sourceObject, 'object');
  });
  registry.register({owner: DATA + 'BindingExpression', name: 'UpdateSource'}, ({context, receiver}) => {
    native(context, receiver, BindingExpression).UpdateSource();
  });
}
