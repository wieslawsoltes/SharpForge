import {Binding, BindingBase} from './binding.js';
import {BindingExpression} from './binding-expression.js';
import {getBindingOperations, bindingsFor} from './adapter-state.js';
import {ValueSource} from '../property/property-store.js';
import {CompiledBindingDefinition} from './compiled/compiler.js';
import {CompiledBindingGroup} from './compiled/group.js';
import {BindingPhaseScheduler} from './compiled/phase-scheduler.js';
import {DeferredXamlElement, DeferredXamlOwner} from './compiled/xaml-deferred.js';
import {initializeVectorContext} from '../observable/vector-adapters.js';

/** Install one setter-binding lifetime and the JavaScript native-value property projection. */
export function initializeBindingContext(context) {
  if (!context.properties) context.properties = javascriptProperties(context);
  initializeVectorContext(context);
  context.compileBinding ??= context.bindingServices?.compileBinding ?? context.services?.compileBinding;
  const operations = getBindingOperations(context);
  context.getBindingOperations = () => operations;
  context.isBinding = value => context.unwrapModel(value) instanceof BindingBase;
  context.bindSetter = specification => new BindingExpression({...specification,
    binding: context.unwrapModel(specification.binding), services: operations.services}).attach();
  context.bindXaml = specification => {
    const binding = context.unwrapModel(specification.binding);
    if (binding instanceof CompiledBindingDefinition) return binding.attach({...specification, binding});
    if (!(binding instanceof Binding)) throw new TypeError('XAML binding must be a supported BindingBase');
    const store = context.storeFor(specification.target);
    const property = specification.property.property ?? specification.property.token
      ?? context.propertyRegistry.lookup(store.ownerType, specification.property.name);
    bindingsFor(context, specification.target);
    return operations.SetBinding(store, context.propertyRegistry.resolve(property), binding);
  };
  context.getCompiledBindings = owner => context.state(owner, 'compiledBindingsRoot', () => new CompiledBindingGroup({weak: true}));
  context.bindingLifecycle = (owner, event) => {
    const group = context.state(owner, 'compiledBindings');
    if (event === 'Loaded') group?.Initialize();
    if (event === 'Unloaded') group?.StopTracking();
  };
  context.getBindingPhases = owner => bindingPhases(context, owner);
  context.deferXamlElement = specification => {
    const group = context.state(specification.parent, 'deferredXamlElements', () => new DeferredXamlOwner());
    const element = new DeferredXamlElement(specification, {bind: context.bindXaml, compileBinding: context.compileBinding,
      identity: context.bindingServices?.deferredElementIdentity ?? context.services?.deferredElementIdentity});
    try { return group.add(element); }
    catch (error) { element.dispose(); throw error; }
  };
  return operations;
}

function bindingPhases(context, owner) {
  const supplied = context.services?.bindingPhasesFor?.(owner);
  if (supplied) return supplied;
  return context.state(owner, 'bindingPhases', () => {
    const scheduler = context.frameScheduler ?? context.services?.scheduler;
    const requestFrame = context.services?.requestFrame ?? (scheduler?.requestFrame ? callback => scheduler.requestFrame(callback) : null);
    const cancelFrame = context.services?.cancelFrame ?? (scheduler?.cancelFrame ? token => scheduler.cancelFrame(token) : () => {});
    return new BindingPhaseScheduler({requestFrame, cancelFrame});
  });
}

function javascriptProperties(context) {
  const registry = context.propertyRegistry;
  const resolve = property => registry.resolve(context.unwrapModel(property));
  const storeFor = receiver => context.storeFor(receiver);
  const token = (type, name) => registry.lookup(context.typeName(type), name);
  const lookup = (receiver, name) => registry.lookup(context.typeOf(receiver), name);
  const wrap = property => context.wrapModel(resolve(property), 'Microsoft.UI.Xaml.DependencyProperty');
  return {
    registry, resolve, lookup, token, wrap, storeFor,
    toNative: (value, type) => type === 'Microsoft.UI.Xaml.DependencyProperty' && value !== null ? resolve(value) : value,
    toManaged: (value, type) => value?.kind === 'DependencyProperty' ? wrap(value) : context.managed(value, type),
    read: (receiver, property, {local = false} = {}) => local ? storeFor(receiver).readLocalValue(resolve(property))
      : storeFor(receiver).getValue(resolve(property)),
    setSource: (receiver, property, source, value) => context.styles.setSource(receiver, resolve(property), source, value),
    clearSource: (receiver, property, source = ValueSource.Local) => context.styles.clearSource(receiver, resolve(property), source),
    parent: (child, parent) => storeFor(child).setParent(parent ? storeFor(parent) : null)
  };
}
