import {ValueSource} from '../property/property-store.js';
import {nativeResourceKey} from './resource-adapter-models.js';

/** A cleared key keeps the registered base-control recipe; an explicit null suppresses that default layer. */
export function defaultStyleSelection(context, owner) {
  const ownerType = typeof owner === 'string' ? owner : context.typeOf(owner);
  const automatic = {key: ownerType, type: ownerType};
  if (typeof owner === 'string') return automatic;
  const property = context.propertyRegistry.lookup(ownerType, 'DefaultStyleKey');
  if (!property) return {key: null, type: ownerType};
  const store = context.storeFor(owner);
  const value = store.getValue(property);
  if (value === null || value === undefined) {
    return store.getValueSource(property) === ValueSource.Default ? automatic : {key: null, type: null};
  }
  const kind = context.typeOf(value);
  const typed = kind === 'System.Type' || kind === 'System.RuntimeType'
    || typeof value === 'function' && typeof value.$type === 'string';
  return {key: nativeResourceKey(context, value), type: typed ? context.typeName(value) : null};
}
