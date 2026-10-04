import {hydratePointerEvent, controlFamilyEventContracts, dragArgumentTypes} from '@sharpforge/winui-controls';
import {eventsFor, frameworkType} from '@sharpforge/framework';
import {projectFacadeEventArguments} from './event-projection.js';

class RoutedArgumentCache {
  constructor() { this.values = new WeakMap(); this.argumentKey = Symbol('registered event arguments'); }
  get reconstructible() { return true; }
  dispose() { this.values = new WeakMap(); }
}

export function facadeEventPayload(context, values, argumentsObject) {
  const cache = context.state(null, 'facadeRoutedArguments', () => new RoutedArgumentCache());
  return {...values, [cache.argumentKey]: argumentsObject};
}

function element(context, value) {
  if (typeof value === 'string') return context.objects.get(value) ?? value;
  if (value?.$ref) return context.reference(value.$ref);
  return value;
}

export function facadeControlEvent(context, receiver, name) {
  let type = context.typeOf(receiver);
  const seen = new Set();
  while (type && !seen.has(type)) {
    seen.add(type);
    const family = controlFamilyEventContracts.get(type + '::' + name);
    if (family) return family;
    type = frameworkType(type)?.base;
  }
  return null;
}

function argumentType(context, payload) {
  const source = element(context, payload.OriginalSource), name = payload.RoutedEvent;
  if (dragArgumentTypes[name]) return dragArgumentTypes[name];
  const family = facadeControlEvent(context, source, name);
  if (family) return family.type;
  const event = eventsFor(context.typeOf(source))[name];
  const delegate = frameworkType(event?.delegate ?? event);
  return delegate?.parameters?.[1] ?? 'Microsoft.UI.Xaml.RoutedEventArgs';
}

/** All callbacks in one route share one argument object, with Handled and Source linked to the router payload. */
export function facadeRoutedEventArgs(context, payload) {
  if (!payload || typeof payload !== 'object') throw new TypeError('A routed event requires a payload');
  const state = context.state(null, 'facadeRoutedArguments', () => new RoutedArgumentCache());
  let args = state.values.get(payload);
  if (args) return args;
  const hydrated = payload.CurrentPoint ? hydratePointerEvent(payload, id => context.host.getLayout(id)) : payload;
  args = payload[state.argumentKey] ?? projectFacadeEventArguments(context, payload, argumentType(context, payload));
  if (hydrated.GetCurrentPoint) {
    const relative = value => value?.$node ? context.id(value) : value;
    args.GetCurrentPoint = value => hydrated.GetCurrentPoint(relative(value));
    args.GetIntermediatePoints = value => hydrated.GetIntermediatePoints(relative(value));
  }
  for (const name of ['OriginalSource', 'Source']) Object.defineProperty(args, name, {
    enumerable: true, get: () => element(context, payload[name]), set: value => { payload[name] = value; }
  });
  for (const name of ['Handled', 'Cancel', 'CanExecute', 'IsBlackout', 'State', 'AcceptedOperation', 'AllowedOperations', 'Content']) {
    if (name !== 'Handled' && !Object.hasOwn(payload, name)) continue;
    if (!Object.getOwnPropertyDescriptor(args, name)?.get) {
      Object.defineProperty(args, name, {enumerable: true, get: () => payload[name], set: value => { payload[name] = value; }});
    }
  }
  state.values.set(payload, args);
  if (payload.RoutedEvent === 'LostFocus') {
    const owner = element(context, payload.OriginalSource);
    if (owner?.$node) context.getBindingOperations().LostFocus(context.storeFor(owner));
  }
  return args;
}

/** Copy only declared writable outcomes; the host's proposed text, identity and reason stay unchanged. */
export function copyFacadeEventOutcome(context, payload, result) {
  const args = facadeRoutedEventArgs(context, payload);
  const definitions = context.propertiesFor(argumentType(context, payload));
  for (const name of ['Handled', 'Cancel', 'CanExecute', 'IsBlackout', 'State', 'AcceptedOperation', 'AllowedOperations', 'Content']) {
    if (definitions[name] && !definitions[name].readOnly) result[name] = context.value(args[name]);
  }
  return result;
}
