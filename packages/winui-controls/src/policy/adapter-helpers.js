import { ControlError } from './events.js';

export const XAML = 'Microsoft.UI.Xaml.';
export const CONTROLS = XAML + 'Controls.';
export const TEXT = 'Microsoft.UI.Text.';
export const DATA = 'Windows.ApplicationModel.DataTransfer.';

export function read(context, receiver, property, fallback = null) {
  const stored = context.read(receiver, property);
  const definition = context.propertiesFor?.(context.typeOf(receiver))?.[property];
  const value = definition?.type === 'bool' && context.properties?.toNative
    ? context.properties.toNative(stored, 'bool') : context.native(stored);
  return value === undefined || value === null ? fallback : value;
}

export function registerMethod(registry, owner, name, action, { kind = 'method', arity = '*' } = {}) {
  return registry.register({ owner, kind, name, arity }, ({ context, receiver, args, descriptor }) =>
    action(context, receiver, args, descriptor));
}

export function registerGet(registry, owner, property, getter) {
  return registerMethod(registry, owner, 'get_' + property, (context, receiver, args, descriptor) =>
    managed(context, getter(context, receiver), descriptor.result), { kind: 'get', arity: 0 });
}

export function managed(context, value, type) {
  return Array.isArray(value) && /Collection$/.test(type) ? context.collection(value, type) : context.managed(value, type);
}

export function registerSet(registry, owner, property, setter) {
  return registerMethod(registry, owner, 'set_' + property, (context, receiver, args) => setter(context, receiver, args[0]),
    { kind: 'set', arity: 1 });
}

export function unsupported(feature) { throw new ControlError('SFUI16F0', feature + ' requires an explicit host capability'); }

export function requireService(context, name) {
  const service = context.services?.[name];
  if (!service) unsupported(name);
  return service;
}

export function invokeHost(context, receiver, method, args = []) {
  const service = context.services?.controls;
  if (!service?.invoke) unsupported(method);
  return service.invoke(receiver, method, args);
}

export function retain(model, ...values) {
  const previous = model.retainedValues?.bind(model);
  model.retainedValues = function* () { if (previous) yield* previous(); yield* values; };
  return model;
}
