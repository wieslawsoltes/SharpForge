import {ResourceReference} from '../resources/reference.js';
import {ResourceFault} from '../resources/errors.js';
import {BindingBase} from '../binding/binding.js';

/** Resolve a Setter.Target without traversing the visual tree; attached properties remain typed tokens. */
export function resolveSetter(setter, context) {
  let target = context.target;
  let property = setter.property;
  if (setter.target) {
    const separator = setter.target.indexOf('.');
    if (separator < 1 || separator === setter.target.length - 1) throw new ResourceFault('SFSTYLE007', 'Expected Target="name.Property".');
    const name = setter.target.slice(0, separator);
    target = context.namescope?.findName(name);
    if (!target) throw new ResourceFault('SFSTYLE008', `Setter target '${name}' was not found in the template namescope.`);
    property = setter.target.slice(separator + 1);
    if (property.startsWith('(') && property.endsWith(')')) property = property.slice(1, -1);
  }
  const store = target === context.target ? context.store : context.storeFor(target);
  if (!store) throw new ResourceFault('SFSTYLE009', 'The setter target has no property store.');
  const descriptor = typeof property === 'string'
    ? context.registry.lookup(store.ownerType, property) : context.registry.resolve(property);
  if (!descriptor || descriptor.readOnly) throw new ResourceFault('SFSTYLE010', 'The setter property is unknown or read-only.');
  return {target, store, property: descriptor, value: setter.value};
}

/** Validate an entire setter list before changing any effective values. Last setter for a slot wins. */
export function prepareSetters(setters, context) {
  const stores = new Map();
  for (const setter of setters) {
    const entry = resolveSetter(setter, context);
    let map = stores.get(entry.store);
    if (!map) stores.set(entry.store, map = new Map());
    if (entry.value instanceof ResourceReference) {
      if (!context.resources) throw new ResourceFault('SFSTYLE011', 'A resource-valued setter requires a resource scope.');
      entry.reference = entry.value;
      entry.value = context.resources.find(entry.reference.key);
      entry.value = materializeSetterResource(context, entry.property, entry.value);
    }
    entry.binding = context.isBinding?.(entry.value) ?? entry.value instanceof BindingBase;
    if (!entry.binding) entry.store.validateValue(entry.property, entry.value, {coerce: false});
    else if (!context.bind) throw new ResourceFault('SFSTYLE012', 'Binding setters require an explicit binding adapter.');
    map.set(entry.property, entry);
  }
  return [...stores.values()].flatMap(map => [...map.values()]);
}

/** Resource descriptors stay host-neutral until the target property's type is known. */
export function materializeSetterResource(context, property, value) {
  return context.materializeResource ? context.materializeResource(value, property.propertyType) : value;
}

/** Multiple stores commit in nested transactions so each store's pending notifications are batched. */
export function transactionStores(stores, action) {
  const sequence = [...new Set(stores)];
  const snapshots = sequence.map(store => store.snapshot());
  const transact = index => index === sequence.length ? action() : sequence[index].transaction(() => transact(index + 1));
  try {
    return transact(0);
  } catch (error) {
    for (let index = 0; index < sequence.length; index++) sequence[index].restore(snapshots[index]);
    throw error;
  }
}
