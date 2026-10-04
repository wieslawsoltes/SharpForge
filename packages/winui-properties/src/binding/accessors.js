import {UnsetValue} from '../property/values.js';
import {ObservableObject, subscribePropertyChanged} from '../observable/observable-object.js';

/** Read a parsed step through host services or explicit JavaScript data adapters. */
export function readPathStep(receiver, step, services) {
  if (receiver === null || receiver === undefined || receiver === UnsetValue) return UnsetValue;
  if (services.read) return services.read(receiver, step);
  if (step.kind === 'attached') {
    const store = services.storeFor?.(receiver);
    const property = store?.registry.lookup(step.owner, step.name);
    return property ? store.getValue(property) : UnsetValue;
  }
  if (step.kind === 'index') {
    if (receiver instanceof Map) return receiver.has(step.key) ? receiver.get(step.key) : UnsetValue;
    if (typeof receiver.get_Item === 'function') {
      if (typeof step.key === 'number' && (step.key < 0 || step.key >= receiver.Count)) return UnsetValue;
      return receiver.get_Item(step.key);
    }
    return Object.hasOwn(Object(receiver), step.key) ? receiver[step.key] : UnsetValue;
  }
  if (receiver instanceof ObservableObject) return receiver.has(step.name) ? receiver.get(step.name) : UnsetValue;
  if (step.name in Object(receiver)) return receiver[step.name];
  return UnsetValue;
}

/** Write the final parsed step; missing intermediate values never create objects. */
export function writePathStep(receiver, step, value, services) {
  if (receiver === null || receiver === undefined || receiver === UnsetValue) throw new TypeError('Binding source is unavailable');
  if (services.write) return services.write(receiver, step, value);
  if (step.kind === 'attached') {
    const store = services.storeFor?.(receiver);
    const property = store?.registry.lookup(step.owner, step.name);
    if (!property) throw new TypeError('Attached binding property is unavailable');
    return store.setValue(property, value);
  }
  if (step.kind === 'index') {
    if (receiver instanceof Map) return receiver.set(step.key, value);
    if (typeof receiver.set_Item === 'function') return receiver.set_Item(step.key, value);
    if (!Object.hasOwn(Object(receiver), step.key)) throw new TypeError('Binding index is unavailable');
    receiver[step.key] = value;
    return value;
  }
  if (receiver instanceof ObservableObject) return receiver.set(step.name, value);
  if (!(step.name in Object(receiver))) throw new TypeError('Binding property is unavailable');
  receiver[step.name] = value;
  return value;
}

/** Subscribe at every receiver so replacing an intermediate path node rebinds. */
export function observePathStep(receiver, step, listener, services) {
  if (!receiver || receiver === UnsetValue) return () => {};
  if (services.subscribe) return services.subscribe(receiver, step, listener) ?? (() => {});
  const store = services.storeFor?.(receiver);
  if (store && step.kind !== 'index') {
    const property = store.registry.lookup(step.owner ?? store.ownerType, step.name);
    if (property) return store.subscribe(property, listener);
  }
  return subscribePropertyChanged(receiver, step.kind === 'index' ? 'Item' : step.name, listener, services);
}
